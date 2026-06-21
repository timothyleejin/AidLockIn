/**
 * lib/patterns.ts
 * ---------------------------------------------------------------------------
 * Surfaces households that keep hitting the duplicate-prevention wall.
 *
 * The hero index already *blocks* every duplicate at INSERT time — this is the
 * reporting layer on top of that: a household whose claim code is denied as a
 * duplicate several times over is worth a coordinator's attention. It might be
 * an honest mix-up (the same family sent between many stations) or a
 * deliberate double-dip attempt. Either way the system already has the raw
 * evidence in `allocation_attempts`; this just aggregates it.
 *
 * Read-only: it never writes, never overrides a block. It reads the trail the
 * allocation engine already lays down (every denial is recorded, NFR3).
 */

import { db } from "./db";

export interface DuplicatePattern {
  householdClaimCode: string;
  deniedDuplicateCount: number;
  aidTypesAttempted: number;
  lastAttemptAt: string;
}

/**
 * Returns households with at least `minDenials` duplicate denials for one
 * event, most-flagged first. Default threshold of 2 keeps a single honest
 * mistake out of the report while catching anything that looks like a pattern.
 */
export async function detectDuplicatePatterns(
  eventId: string,
  minDenials = 2
): Promise<DuplicatePattern[]> {
  const { rows } = await db.query<{
    household_claim_code: string;
    denied_count: string;
    aid_types: string;
    last_attempt_at: string;
  }>(
    `SELECT household_claim_code,
            COUNT(*) AS denied_count,
            COUNT(DISTINCT aid_type_id) AS aid_types,
            MAX(created_at) AS last_attempt_at
     FROM allocation_attempts
     WHERE event_id = $1 AND result = 'DENIED_DUPLICATE'
     GROUP BY household_claim_code
     HAVING COUNT(*) >= $2
     ORDER BY denied_count DESC, last_attempt_at DESC`,
    [eventId, minDenials]
  );

  return rows.map((r) => ({
    householdClaimCode: r.household_claim_code,
    deniedDuplicateCount: Number(r.denied_count),
    aidTypesAttempted: Number(r.aid_types),
    lastAttemptAt: r.last_attempt_at,
  }));
}
