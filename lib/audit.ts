import { createHash } from "node:crypto";
import { db } from "./db";
import type { AuditAction, AuditEventRow } from "./types";

interface AppendAuditEventInput {
  eventId: string;
  action: AuditAction;
  actorName?: string | null;
  actorRole?: string | null;
  organizationId?: string | null;
  householdId?: string | null;
  householdClaimCode?: string | null;
  aidTypeId?: string | null;
  detail: string;
  payload?: Record<string, unknown>;
}

// Every call site passes `db` itself (audit rows are deliberately written as
// their own statement, never inside the transaction client being audited —
// see the note below) so this only needs to describe `db`'s shape.
type Queryable = Pick<typeof db, "query">;

/**
 * Appends one row to the immutable audit log and extends the hash chain.
 *
 * IMPORTANT: this is always called as its OWN statement, never nested inside
 * the allocation transaction that might roll back. A denial is exactly as
 * important to the audit trail as an approval (NFR3) — if we wrote the audit
 * row inside the transaction we're auditing, a rollback would silently erase
 * the very denial we wanted a permanent record of.
 *
 * The chain itself (`prev_hash` -> `hash`) is a pragmatic, demo-appropriate
 * tamper-evidence mechanism: each row's hash commits to the previous row's
 * hash plus this row's payload, so editing or deleting a historical row
 * breaks every hash after it, which /api/audit's verify step detects. A
 * production-grade ledger would want a more rigorous append-only sequencing
 * primitive; for the hackathon's purposes this is the right amount of
 * machinery for what it's proving.
 */
export async function appendAuditEvent(
  q: Queryable,
  input: AppendAuditEventInput
): Promise<{ auditNo: number; hash: string }> {
  const prevResult = await q.query<{ hash: string }>(
    `SELECT hash FROM audit_events WHERE event_id = $1 ORDER BY audit_no DESC LIMIT 1`,
    [input.eventId]
  );
  const prevHash = prevResult.rows[0]?.hash ?? "GENESIS";
  const createdAt = new Date().toISOString();
  const payloadJson = JSON.stringify(input.payload ?? {});

  const hash = createHash("sha256")
    .update(prevHash)
    .update(input.action)
    .update(input.detail)
    .update(payloadJson)
    .update(createdAt)
    .digest("hex");

  const inserted = await q.query<{ audit_no: number; hash: string }>(
    `INSERT INTO audit_events (
       event_id, action, actor_name, actor_role, organization_id,
       household_id, household_claim_code, aid_type_id, detail, payload,
       prev_hash, hash, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING audit_no, hash`,
    [
      input.eventId,
      input.action,
      input.actorName ?? null,
      input.actorRole ?? null,
      input.organizationId ?? null,
      input.householdId ?? null,
      input.householdClaimCode ?? null,
      input.aidTypeId ?? null,
      input.detail,
      payloadJson,
      prevHash,
      hash,
      createdAt,
    ]
  );

  const row = inserted.rows[0];
  return { auditNo: Number(row.audit_no), hash: row.hash };
}

export async function fetchAuditFeed(eventId: string, limit?: number): Promise<AuditEventRow[]> {
  const safeLimit = limit && Number.isInteger(limit) && limit > 0 ? limit : null;
  const { rows } = await db.query<AuditEventRow>(
    `SELECT ae.id, ae.audit_no, ae.event_id, ae.action, ae.actor_name, ae.actor_role,
            o.name AS organization_name, ae.household_claim_code, at.name AS aid_type_name,
            ae.detail, ae.hash, ae.created_at
     FROM audit_events ae
     LEFT JOIN organizations o ON o.id = ae.organization_id
     LEFT JOIN aid_types at ON at.id = ae.aid_type_id
     WHERE ae.event_id = $1
     ORDER BY ae.audit_no DESC
     ${safeLimit ? `LIMIT ${safeLimit}` : ""}`,
    [eventId]
  );
  return rows;
}

/**
 * Walks the chain for one event and confirms every link still matches.
 *
 * This deliberately verifies a DAG, not a single line: two allocation
 * attempts can be in flight at the same instant (that's the entire point of
 * the race demo!), so two audit rows can legitimately cite the same
 * `prev_hash` — they were both the "latest" row when each transaction's
 * audit entry was written. What must hold, and what tampering would break,
 * is (a) every row's hash is exactly the hash of its own recorded contents,
 * and (b) every row's `prev_hash` is either the chain's genesis marker or
 * the hash of some earlier row that itself checks out. Edit or delete a
 * historical row and its hash changes (or disappears), which breaks
 * verification for it and for anything that cites it — that's the
 * tamper-evidence; it just doesn't force a false choice between "real
 * concurrency happened" and "the log is trustworthy."
 */
export async function verifyAuditChain(eventId: string): Promise<boolean> {
  const { rows } = await db.query<{
    audit_no: number;
    action: string;
    detail: string;
    payload: string;
    prev_hash: string;
    hash: string;
    created_at: string;
  }>(
    `SELECT audit_no, action, detail, payload, prev_hash, hash, created_at
     FROM audit_events WHERE event_id = $1 ORDER BY audit_no ASC`,
    [eventId]
  );

  const seenHashes = new Set<string>(["GENESIS"]);
  for (const row of rows) {
    if (!seenHashes.has(row.prev_hash)) return false;
    const recomputed = createHash("sha256")
      .update(row.prev_hash)
      .update(row.action)
      .update(row.detail)
      .update(row.payload ?? "{}")
      .update(new Date(row.created_at).toISOString())
      .digest("hex");
    if (recomputed !== row.hash) return false;
    seenHashes.add(row.hash);
  }
  return true;
}
