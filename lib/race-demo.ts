/**
 * lib/race-demo.ts
 * ---------------------------------------------------------------------------
 * Drives the "Two regions. One last bed. One winner." screen.
 *
 * This is not a UI-only animation. Both stations call the exact same
 * `performAllocation()` used by the real field-allocation screen, fired
 * concurrently with `Promise.allSettled`, against the exact same database
 * row. Whichever transaction's commit Aurora DSQL accepts first wins; the
 * other gets retried by the connector and then cleanly denied once it sees
 * the committed state. The two "regions" are a labeling convenience for the
 * demo narrative — what's real is the concurrency control underneath it.
 */

import { db } from "./db";
import { generateClaimCode, generateIdempotencyKey } from "./ids";
import { performAllocation } from "./allocation";
import type { AllocateResponse } from "./types";

const RACE_BED_LABEL = "Bed A12";

interface RaceStationConfig {
  label: "Station A" | "Station B";
  region: "Tokyo" | "Osaka";
  organizationId: string;
  distributionPoint: string;
}

export interface RaceDemoResult {
  bedLabel: string;
  stations: {
    station: string;
    region: string;
    householdClaimCode: string;
    outcome: AllocateResponse;
  }[];
}

/**
 * Ensures exactly one fresh, available "Bed A12" exists for this event's
 * shelter-bed aid type, so the "Run it again" button is always repeatable
 * regardless of how the previous run ended. Returns its resource id so the
 * caller can target it explicitly — without that, both stations would just
 * fall back to whichever *other* bed was still free and both "win",
 * defeating the entire point of the demo.
 */
async function resetRaceBed(eventId: string, aidTypeId: string): Promise<string> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM resources WHERE event_id = $1 AND aid_type_id = $2 AND label = $3`,
    [eventId, aidTypeId, RACE_BED_LABEL]
  );
  if (existing.rows[0]) {
    await db.query(
      `UPDATE resources
       SET status = 'AVAILABLE', allocated_to_household_id = NULL, allocated_by_allocation_id = NULL, updated_at = now()
       WHERE id = $1`,
      [existing.rows[0].id]
    );
    return existing.rows[0].id;
  }
  const created = await db.query<{ id: string }>(
    `INSERT INTO resources (event_id, aid_type_id, label, status) VALUES ($1,$2,$3,'AVAILABLE') RETURNING id`,
    [eventId, aidTypeId, RACE_BED_LABEL]
  );
  return created.rows[0].id;
}

export async function runRaceDemo(eventId: string, aidTypeId: string): Promise<RaceDemoResult> {
  const orgs = await db.query<{ id: string; name: string }>(
    `SELECT organization_id AS id, o.name FROM event_partners ep
     JOIN organizations o ON o.id = ep.organization_id
     WHERE ep.event_id = $1 ORDER BY o.name LIMIT 2`,
    [eventId]
  );
  if (orgs.rows.length < 2) {
    throw new Error("This event needs at least two partner organizations to run the race demo.");
  }

  const targetResourceId = await resetRaceBed(eventId, aidTypeId);

  const stations: RaceStationConfig[] = [
    {
      label: "Station A",
      region: "Tokyo",
      organizationId: orgs.rows[0].id,
      distributionPoint: "Tokyo Aid Station",
    },
    {
      label: "Station B",
      region: "Osaka",
      organizationId: orgs.rows[1].id,
      distributionPoint: "Osaka Aid Station",
    },
  ];

  const householdCodes = stations.map(() => generateClaimCode());

  const settled = await Promise.allSettled(
    stations.map((station, i) =>
      performAllocation({
        eventId,
        claimCode: householdCodes[i],
        aidTypeId,
        organizationId: station.organizationId,
        workerName: `${station.label} worker`,
        distributionPoint: station.distributionPoint,
        idempotencyKey: generateIdempotencyKey(),
        simulatedRegion: station.region,
        actorRole: "FIELD",
        targetResourceId,
      })
    )
  );

  const outcomes = settled.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    // Genuinely unexpected (not a business denial) — surface it rather than
    // silently swallowing it, since this is the demo's hero moment.
    throw result.reason ?? new Error(`Station ${i} failed unexpectedly`);
  });

  return {
    bedLabel: RACE_BED_LABEL,
    stations: stations.map((station, i) => ({
      station: station.label,
      region: station.region,
      householdClaimCode: householdCodes[i],
      outcome: outcomes[i],
    })),
  };
}
