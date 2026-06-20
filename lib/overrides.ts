import { appendAuditEvent } from "./audit";
import { db } from "./db";
import { runOverrideAllocation, fetchAidTypeContext } from "./allocation";
import type { OverrideRequestRow, OverrideStatus } from "./types";

interface CreateOverrideInput {
  eventId: string;
  householdClaimCode: string;
  aidTypeId: string;
  allocationAttemptId: string | null;
  requestedByOrgId: string;
  requestedByName: string;
  reason: string;
}

export async function createOverrideRequest(input: CreateOverrideInput): Promise<string> {
  const household = await db.query<{ id: string }>(
    `SELECT id FROM households WHERE event_id = $1 AND claim_code = $2`,
    [input.eventId, input.householdClaimCode]
  );
  const householdId = household.rows[0]?.id;
  if (!householdId) {
    throw new Error("Household not found — re-check the claim code before requesting an override.");
  }

  const ins = await db.query<{ id: string }>(
    `INSERT INTO override_requests (
       event_id, household_id, aid_type_id, allocation_attempt_id,
       requested_by_org_id, requested_by_name, reason, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING') RETURNING id`,
    [
      input.eventId,
      householdId,
      input.aidTypeId,
      input.allocationAttemptId,
      input.requestedByOrgId,
      input.requestedByName,
      input.reason,
    ]
  );
  const overrideId = ins.rows[0].id;

  const aidType = await fetchAidTypeContext(input.aidTypeId);
  await appendAuditEvent(db, {
    eventId: input.eventId,
    action: "OVERRIDE_REQUESTED",
    actorName: input.requestedByName,
    actorRole: "FIELD",
    organizationId: input.requestedByOrgId,
    householdId,
    householdClaimCode: input.householdClaimCode,
    aidTypeId: input.aidTypeId,
    detail: `Override requested for ${aidType?.name ?? "aid"} — ${input.reason}`,
    payload: { overrideId },
  });

  return overrideId;
}

interface DecideOverrideInput {
  overrideId: string;
  decision: "APPROVED" | "REJECTED";
  decidedByName: string;
  decisionNote?: string;
  distributionPoint: string;
}

interface DecideOverrideResult {
  status: OverrideStatus;
  allocationSucceeded: boolean;
  message: string;
}

export async function decideOverride(input: DecideOverrideInput): Promise<DecideOverrideResult> {
  const { rows } = await db.query<{
    id: string;
    event_id: string;
    household_id: string;
    household_claim_code: string;
    aid_type_id: string;
    aid_type_name: string;
    requested_by_org_id: string;
    requested_by_name: string;
    status: OverrideStatus;
  }>(
    `SELECT ovr.id, ovr.event_id, ovr.household_id, h.claim_code AS household_claim_code,
            ovr.aid_type_id, at.name AS aid_type_name,
            ovr.requested_by_org_id, ovr.requested_by_name, ovr.status
     FROM override_requests ovr
     JOIN households h ON h.id = ovr.household_id
     JOIN aid_types at ON at.id = ovr.aid_type_id
     WHERE ovr.id = $1`,
    [input.overrideId]
  );
  const row = rows[0];
  if (!row) throw new Error("Override request not found.");
  if (row.status !== "PENDING") throw new Error(`This override was already ${row.status.toLowerCase()}.`);

  if (input.decision === "REJECTED") {
    await db.query(
      `UPDATE override_requests SET status = 'REJECTED', decided_by_name = $1, decision_note = $2, decided_at = now()
       WHERE id = $3`,
      [input.decidedByName, input.decisionNote ?? null, input.overrideId]
    );
    await appendAuditEvent(db, {
      eventId: row.event_id,
      action: "OVERRIDE_REJECTED",
      actorName: input.decidedByName,
      actorRole: "COORDINATOR",
      householdId: row.household_id,
      householdClaimCode: row.household_claim_code,
      aidTypeId: row.aid_type_id,
      detail: `Override rejected for ${row.aid_type_name}${input.decisionNote ? ` — ${input.decisionNote}` : ""}.`,
      payload: { overrideId: input.overrideId },
    });
    return { status: "REJECTED", allocationSucceeded: false, message: "Override rejected." };
  }

  // APPROVED — mark the decision first (it stands regardless of whether
  // stock still happens to be available), then attempt the allocation.
  await db.query(
    `UPDATE override_requests SET status = 'APPROVED', decided_by_name = $1, decision_note = $2, decided_at = now()
     WHERE id = $3`,
    [input.decidedByName, input.decisionNote ?? null, input.overrideId]
  );

  try {
    const result = await runOverrideAllocation({
      eventId: row.event_id,
      householdId: row.household_id,
      aidTypeId: row.aid_type_id,
      organizationId: row.requested_by_org_id,
      distributionPoint: input.distributionPoint,
      overrideId: input.overrideId,
    });

    await appendAuditEvent(db, {
      eventId: row.event_id,
      action: "OVERRIDE_APPROVED",
      actorName: input.decidedByName,
      actorRole: "COORDINATOR",
      organizationId: row.requested_by_org_id,
      householdId: row.household_id,
      householdClaimCode: row.household_claim_code,
      aidTypeId: row.aid_type_id,
      detail: `Override approved for ${row.aid_type_name}${input.decisionNote ? ` — ${input.decisionNote}` : ""}. Allocated to ${row.requested_by_name}.`,
      payload: { overrideId: input.overrideId, allocationId: result.allocationId, resourceLabel: result.resourceLabel },
    });

    return {
      status: "APPROVED",
      allocationSucceeded: true,
      message: "Override approved and allocated.",
    };
  } catch {
    // Decision stands, but there was genuinely nothing left to give.
    await appendAuditEvent(db, {
      eventId: row.event_id,
      action: "OVERRIDE_APPROVED",
      actorName: input.decidedByName,
      actorRole: "COORDINATOR",
      organizationId: row.requested_by_org_id,
      householdId: row.household_id,
      householdClaimCode: row.household_claim_code,
      aidTypeId: row.aid_type_id,
      detail: `Override approved for ${row.aid_type_name}, but no stock remained to allocate.`,
      payload: { overrideId: input.overrideId },
    });
    return {
      status: "APPROVED",
      allocationSucceeded: false,
      message: "Override approved, but no stock remained to allocate.",
    };
  }
}

export async function listOverrideRequests(eventId: string): Promise<OverrideRequestRow[]> {
  const { rows } = await db.query<OverrideRequestRow>(
    `SELECT ovr.id, ovr.event_id, ovr.household_id, h.claim_code AS household_claim_code,
            ovr.aid_type_id, at.name AS aid_type_name, ovr.allocation_attempt_id,
            o.name AS requested_by_org_name, ovr.requested_by_name, ovr.reason, ovr.status,
            ovr.decided_by_name, ovr.decision_note, ovr.created_at, ovr.decided_at
     FROM override_requests ovr
     JOIN households h ON h.id = ovr.household_id
     JOIN aid_types at ON at.id = ovr.aid_type_id
     JOIN organizations o ON o.id = ovr.requested_by_org_id
     WHERE ovr.event_id = $1
     ORDER BY ovr.created_at DESC`,
    [eventId]
  );
  return rows;
}
