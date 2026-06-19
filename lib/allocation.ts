/**
 * lib/allocation.ts

* The transactional heart of AidLockIn. Every "Check & allocate" tap, both
 * sides of the race demo, and every override approval all flow through
 * `runAllocationCore`, executed inside `db.transaction(...)`.
 
 * Two independent guarantees are enforced here, on purpose by two different
 * mechanisms — see the strategic brief's "the hero is the duplicate claim,
 * not just the shelter bed" framing:
 
 *  - FR7 "the same scarce resource can't go to two households": enforced by
 *    `UPDATE resources ... WHERE status = 'AVAILABLE'` (and the pool
 *    equivalent on resource_pools.remaining_quantity). Under Aurora DSQL's
 *    optimistic concurrency control, two simultaneous attempts on the same
 *    row aren't blocked against each other — they both proceed, and the
 *    *second to commit* gets a 40001 serialization failure. The official
 *    `@aws/aurora-dsql-node-postgres-connector` retries the whole
 *    transaction automatically on 40001 (see lib/db.ts); by the time the
 *    retry runs, it sees the committed state and resolves to a clean,
 *    deterministic "already taken" — no UI-level locking, no polling.
 
 *  - FR6 "a household can't get the same aid type twice inside its policy
 *    window": enforced by a UNIQUE INDEX on entitlement_claims, not by a
 *    SELECT-then-INSERT check. A read-then-write check has a race: two
 *    concurrent transactions can both read "no existing claim" before
 *    either has inserted. A unique index has no such gap — the database
 *    itself is the single source of truth at INSERT time.
 */

import { appendAuditEvent } from "./audit";
import { db, type DbClient } from "./db";
import { computePolicyWindowBucket } from "./policy";
import { formatClock } from "./utils";
import type { AllocateRequest, AllocateResponse, ResourceModel, WindowType } from "./types";

export class DuplicateEntitlementError extends Error {
  constructor() {
    super("Duplicate entitlement claim");
    this.name = "DuplicateEntitlementError";
  }
}

export class ResourceTakenError extends Error {
  label: string;
  constructor(label: string) {
    super(`Resource already taken: ${label}`);
    this.name = "ResourceTakenError";
    this.label = label;
  }
}

export class NoStockError extends Error {
  constructor() {
    super("No stock remaining");
    this.name = "NoStockError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

interface AidTypeContext {
  id: string;
  eventId: string;
  code: string;
  name: string;
  icon: string;
  resourceModel: ResourceModel;
  windowType: WindowType;
  windowValue: number | null;
  poolId: string | null;
}

export async function fetchAidTypeContext(aidTypeId: string): Promise<AidTypeContext | null> {
  const { rows } = await db.query<{
    id: string;
    event_id: string;
    code: string;
    name: string;
    icon: string;
    resource_model: ResourceModel;
    window_type: WindowType;
    window_value: number | null;
    pool_id: string | null;
  }>(
    `SELECT at.id, at.event_id, at.code, at.name, at.icon, at.resource_model,
            ap.window_type, ap.window_value, rp.id AS pool_id
     FROM aid_types at
     JOIN aid_policies ap ON ap.aid_type_id = at.id
     LEFT JOIN resource_pools rp ON rp.aid_type_id = at.id
     WHERE at.id = $1`,
    [aidTypeId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    code: row.code,
    name: row.name,
    icon: row.icon,
    resourceModel: row.resource_model,
    windowType: row.window_type,
    windowValue: row.window_value,
    poolId: row.pool_id,
  };
}

/**
 * Finds or creates a household by claim code. Deliberately its own
 * statement, committed immediately and independent of whether the
 * allocation that follows succeeds — registering a claim code is a durable
 * fact about the world, not something that should vanish if a later step in
 * the same request happens to roll back (UC01 extension 2a).
 */
export async function resolveOrCreateHousehold(
  eventId: string,
  claimCode: string,
  createdByOrgId?: string | null
): Promise<string> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM households WHERE event_id = $1 AND claim_code = $2`,
    [eventId, claimCode]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  try {
    const created = await db.query<{ id: string }>(
      `INSERT INTO households (event_id, claim_code, created_by_org_id) VALUES ($1,$2,$3) RETURNING id`,
      [eventId, claimCode, createdByOrgId ?? null]
    );
    return created.rows[0].id;
  } catch (err) {
    // Two workers registered the same new code in the same instant.
    if (isUniqueViolation(err)) {
      const retry = await db.query<{ id: string }>(
        `SELECT id FROM households WHERE event_id = $1 AND claim_code = $2`,
        [eventId, claimCode]
      );
      if (retry.rows[0]) return retry.rows[0].id;
    }
    throw err;
  }
}

interface RunCoreInput {
  eventId: string;
  householdId: string;
  aidType: AidTypeContext;
  organizationId: string;
  distributionPoint: string;
  isOverride: boolean;
  overrideId?: string | null;
  /**
   * Claim this exact resource row, with no fallback to the next available
   * unit if it's already gone. The default (unset) behavior — try the next
   * few available units before giving up — is what a real field worker
   * wants: "no stock" should mean *no stock left*, not *the very first one
   * I tried happened to be taken a moment ago*. The race demo wants the
   * opposite: it needs both stations genuinely contending for one specific
   * bed, so a station that loses must be denied outright, not quietly
   * handed a different bed instead.
   */
  targetResourceId?: string;
}

interface RunCoreResult {
  allocationId: string;
  resourceLabel?: string;
  remaining?: number;
}

async function runAllocationCore(client: DbClient, input: RunCoreInput): Promise<RunCoreResult> {
  const {
    eventId,
    householdId,
    aidType,
    organizationId,
    distributionPoint,
    isOverride,
    overrideId,
    targetResourceId,
  } = input;

  // 1. Entitlement dedup — the unique index is the enforcement, this insert
  //    is just the attempt to claim a slot in it.
  let bucket = computePolicyWindowBucket(aidType.windowType, aidType.windowValue);
  if (isOverride) bucket = `${bucket}::override::${overrideId}`;

  let entitlementId: string;
  try {
    const ins = await client.query<{ id: string }>(
      `INSERT INTO entitlement_claims (event_id, household_id, aid_type_id, policy_window_bucket, is_override)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [eventId, householdId, aidType.id, bucket, isOverride]
    );
    entitlementId = ins.rows[0].id;
  } catch (err) {
    if (!isOverride && isUniqueViolation(err)) throw new DuplicateEntitlementError();
    throw err;
  }

  // 2. Consume the resource — pool decrement or named-unit claim.
  let resourceId: string | null = null;
  let poolId: string | null = null;
  let resourceLabel: string | undefined;
  let remaining: number | undefined;

  if (aidType.resourceModel === "POOL") {
    if (!aidType.poolId) throw new NoStockError();
    const upd = await client.query<{ remaining_quantity: number }>(
      `UPDATE resource_pools SET remaining_quantity = remaining_quantity - 1, updated_at = now()
       WHERE id = $1 AND remaining_quantity > 0
       RETURNING remaining_quantity`,
      [aidType.poolId]
    );
    if (upd.rowCount === 0) throw new NoStockError();
    poolId = aidType.poolId;
    remaining = upd.rows[0].remaining_quantity;
  } else if (targetResourceId) {
    const upd = await client.query<{ id: string; label: string }>(
      `UPDATE resources SET status = 'ALLOCATED', allocated_to_household_id = $1, updated_at = now()
       WHERE id = $2 AND status = 'AVAILABLE'
       RETURNING id, label`,
      [householdId, targetResourceId]
    );
    if (upd.rowCount === 0) {
      const existing = await client.query<{ label: string }>(`SELECT label FROM resources WHERE id = $1`, [
        targetResourceId,
      ]);
      throw new ResourceTakenError(existing.rows[0]?.label ?? "this resource");
    }
    resourceId = upd.rows[0].id;
    resourceLabel = upd.rows[0].label;
  } else {
    const candidates = await client.query<{ id: string; label: string }>(
      `SELECT id, label FROM resources
       WHERE aid_type_id = $1 AND status = 'AVAILABLE'
       ORDER BY label LIMIT 5`,
      [aidType.id]
    );
    if (candidates.rows.length === 0) throw new NoStockError();

    let claimed: { id: string; label: string } | null = null;
    for (const candidate of candidates.rows) {
      const upd = await client.query<{ id: string; label: string }>(
        `UPDATE resources SET status = 'ALLOCATED', allocated_to_household_id = $1, updated_at = now()
         WHERE id = $2 AND status = 'AVAILABLE'
         RETURNING id, label`,
        [householdId, candidate.id]
      );
      if (upd.rowCount && upd.rowCount > 0) {
        claimed = upd.rows[0];
        break;
      }
    }
    if (!claimed) throw new ResourceTakenError(candidates.rows[0].label);
    resourceId = claimed.id;
    resourceLabel = claimed.label;
  }

  // 3. The allocation record itself, and link it back to the entitlement.
  const allocIns = await client.query<{ id: string }>(
    `INSERT INTO allocations (
       event_id, household_id, aid_type_id, resource_id, pool_id,
       organization_id, distribution_point, is_override, override_request_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      eventId,
      householdId,
      aidType.id,
      resourceId,
      poolId,
      organizationId,
      distributionPoint,
      isOverride,
      overrideId ?? null,
    ]
  );
  const allocationId = allocIns.rows[0].id;

  await client.query(`UPDATE entitlement_claims SET allocation_id = $1 WHERE id = $2`, [
    allocationId,
    entitlementId,
  ]);
  await client.query(
    `UPDATE resources SET allocated_by_allocation_id = $1 WHERE id = $2`,
    [allocationId, resourceId]
  );

  return { allocationId, resourceLabel, remaining };
}

interface ExistingClaimInfo {
  organizationName: string;
  claimedAt: string;
  workerName: string | null;
}

async function findExistingClaim(
  eventId: string,
  householdId: string,
  aidTypeId: string
): Promise<ExistingClaimInfo | null> {
  const { rows } = await db.query<{
    organization_name: string;
    claimed_at: string;
    worker_name: string | null;
  }>(
    `SELECT o.name AS organization_name, a.created_at AS claimed_at, aa.worker_name
     FROM entitlement_claims ec
     JOIN allocations a ON a.id = ec.allocation_id
     JOIN organizations o ON o.id = a.organization_id
     LEFT JOIN allocation_attempts aa ON aa.allocation_id = a.id
     WHERE ec.event_id = $1 AND ec.household_id = $2 AND ec.aid_type_id = $3
       AND ec.is_override = false
     ORDER BY a.created_at DESC LIMIT 1`,
    [eventId, householdId, aidTypeId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    organizationName: row.organization_name,
    claimedAt: row.claimed_at,
    workerName: row.worker_name,
  };
}

function describeApproval(aidType: AidTypeContext, result: RunCoreResult): string {
  if (aidType.resourceModel === "POOL") {
    return `${aidType.name} allocated. Remaining stock: ${result.remaining}.`;
  }
  return `${aidType.name} allocated — ${result.resourceLabel}.`;
}

export interface PerformAllocationInput extends AllocateRequest {
  actorRole: string;
}

export async function performAllocation(input: PerformAllocationInput): Promise<AllocateResponse> {
  const aidType = await fetchAidTypeContext(input.aidTypeId);
  if (!aidType) throw new Error("Unknown aid type");

  const householdId = await resolveOrCreateHousehold(
    input.eventId,
    input.claimCode,
    input.organizationId
  );

  const attemptIns = await db.query<{ id: string }>(
    `INSERT INTO allocation_attempts (
       event_id, household_id, household_claim_code, aid_type_id, organization_id,
       worker_name, distribution_point, idempotency_key, result, simulated_region
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9) RETURNING id`,
    [
      input.eventId,
      householdId,
      input.claimCode,
      input.aidTypeId,
      input.organizationId,
      input.workerName,
      input.distributionPoint,
      input.idempotencyKey,
      input.simulatedRegion ?? null,
    ]
  );
  const attemptId = attemptIns.rows[0].id;

  try {
    const result = await db.transaction((client) =>
      runAllocationCore(client, {
        eventId: input.eventId,
        householdId,
        aidType,
        organizationId: input.organizationId,
        distributionPoint: input.distributionPoint,
        isOverride: false,
        targetResourceId: input.targetResourceId,
      })
    );

    await db.query(
      `UPDATE allocation_attempts SET result = 'APPROVED', allocation_id = $1 WHERE id = $2`,
      [result.allocationId, attemptId]
    );

    const detail = describeApproval(aidType, result);
    const { auditNo } = await appendAuditEvent(db, {
      eventId: input.eventId,
      action: "ALLOCATION_APPROVED",
      actorName: input.workerName,
      actorRole: input.actorRole,
      organizationId: input.organizationId,
      householdId,
      householdClaimCode: input.claimCode,
      aidTypeId: input.aidTypeId,
      detail,
      payload: {
        allocationId: result.allocationId,
        resourceLabel: result.resourceLabel,
        remaining: result.remaining,
        simulatedRegion: input.simulatedRegion,
      },
    });

    return {
      result: "APPROVED",
      attemptId,
      auditNo,
      message: "Approved",
      detail,
      householdClaimCode: input.claimCode,
      aidTypeName: aidType.name,
      resourceLabel: result.resourceLabel,
      remaining: result.remaining,
      overrideEligible: false,
    };
  } catch (err) {
    return handleAllocationError(err, { attemptId, householdId, aidType, input });
  }
}

async function handleAllocationError(
  err: unknown,
  ctx: { attemptId: string; householdId: string; aidType: AidTypeContext; input: PerformAllocationInput }
): Promise<AllocateResponse> {
  const { attemptId, householdId, aidType, input } = ctx;

  if (err instanceof DuplicateEntitlementError) {
    const existing = await findExistingClaim(input.eventId, householdId, input.aidTypeId);
    const reason = existing
      ? `This household already received a ${aidType.name.toLowerCase()} from ${existing.organizationName} at ${formatClock(existing.claimedAt)}.`
      : `Already received ${aidType.name.toLowerCase()} within this policy window.`;

    await db.query(
      `UPDATE allocation_attempts SET result = 'DENIED_DUPLICATE', denial_reason = $1 WHERE id = $2`,
      [reason, attemptId]
    );
    const { auditNo } = await appendAuditEvent(db, {
      eventId: input.eventId,
      action: "ALLOCATION_DENIED_DUPLICATE",
      actorName: input.workerName,
      actorRole: input.actorRole,
      organizationId: input.organizationId,
      householdId,
      householdClaimCode: input.claimCode,
      aidTypeId: input.aidTypeId,
      detail: reason,
      payload: { simulatedRegion: input.simulatedRegion },
    });

    return {
      result: "DENIED_DUPLICATE",
      attemptId,
      auditNo,
      message: "Already claimed",
      detail: reason,
      householdClaimCode: input.claimCode,
      aidTypeName: aidType.name,
      overrideEligible: true,
      existingClaim: existing ?? undefined,
    };
  }

  if (err instanceof ResourceTakenError) {
    const reason = `${aidType.name} · ${err.label} already allocated by another station moments ago.`;
    await db.query(
      `UPDATE allocation_attempts SET result = 'DENIED_RESOURCE_TAKEN', denial_reason = $1 WHERE id = $2`,
      [reason, attemptId]
    );
    const { auditNo } = await appendAuditEvent(db, {
      eventId: input.eventId,
      action: "ALLOCATION_DENIED_RESOURCE_TAKEN",
      actorName: input.workerName,
      actorRole: input.actorRole,
      organizationId: input.organizationId,
      householdId,
      householdClaimCode: input.claimCode,
      aidTypeId: input.aidTypeId,
      detail: reason,
      payload: { label: err.label, simulatedRegion: input.simulatedRegion },
    });

    return {
      result: "DENIED_RESOURCE_TAKEN",
      attemptId,
      auditNo,
      message: "Just taken",
      detail: reason,
      householdClaimCode: input.claimCode,
      aidTypeName: aidType.name,
      overrideEligible: false,
    };
  }

  if (err instanceof NoStockError) {
    const reason = `No ${aidType.name.toLowerCase()} remaining at this distribution point.`;
    await db.query(
      `UPDATE allocation_attempts SET result = 'DENIED_NO_STOCK', denial_reason = $1 WHERE id = $2`,
      [reason, attemptId]
    );
    const { auditNo } = await appendAuditEvent(db, {
      eventId: input.eventId,
      action: "ALLOCATION_DENIED_NO_STOCK",
      actorName: input.workerName,
      actorRole: input.actorRole,
      organizationId: input.organizationId,
      householdId,
      householdClaimCode: input.claimCode,
      aidTypeId: input.aidTypeId,
      detail: reason,
      payload: { simulatedRegion: input.simulatedRegion },
    });

    return {
      result: "DENIED_NO_STOCK",
      attemptId,
      auditNo,
      message: "Out of stock",
      detail: reason,
      householdClaimCode: input.claimCode,
      aidTypeName: aidType.name,
      overrideEligible: false,
    };
  }

  await db.query(`UPDATE allocation_attempts SET result = 'ERROR', denial_reason = $1 WHERE id = $2`, [
    String(err),
    attemptId,
  ]);
  throw err;
}

/** Used only by the override-approval flow (lib/overrides.ts). */
export async function runOverrideAllocation(input: {
  eventId: string;
  householdId: string;
  aidTypeId: string;
  organizationId: string;
  distributionPoint: string;
  overrideId: string;
}): Promise<RunCoreResult> {
  const aidType = await fetchAidTypeContext(input.aidTypeId);
  if (!aidType) throw new Error("Unknown aid type");
  return db.transaction((client) =>
    runAllocationCore(client, {
      eventId: input.eventId,
      householdId: input.householdId,
      aidType,
      organizationId: input.organizationId,
      distributionPoint: input.distributionPoint,
      isOverride: true,
      overrideId: input.overrideId,
    })
  );
}
