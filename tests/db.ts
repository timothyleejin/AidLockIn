// Shared test helpers: detect whether a database is configured, and stand up
// a fully self-contained event (organization, aid types, policies, stock) so
// the hero-guarantee tests don't depend on the demo seed being present.
//
// Everything created here is keyed to one random event id and torn down in
// `cleanup()`. No foreign keys exist in the schema (a DSQL constraint), so
// delete order doesn't matter.

import { db } from "@/lib/db";

export const hasDb = Boolean(
  process.env.DATABASE_URL || process.env.PGHOST || process.env.DSQL_ENDPOINT
);

function rand(n = 6): string {
  return Math.random().toString(36).slice(2, 2 + n).toUpperCase();
}

export interface TestEvent {
  eventId: string;
  orgId: string;
  /** POOL aid type with a per-event duplicate window and 5 units of stock. */
  poolAidTypeId: string;
  /** UNIT aid type with exactly one named bed, for the race test. */
  unitAidTypeId: string;
  bedResourceId: string;
  cleanup: () => Promise<void>;
}

export async function setupTestEvent(): Promise<TestEvent> {
  const suffix = rand();

  const org = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, org_type) VALUES ($1, 'NGO') RETURNING id`,
    [`Test Org ${suffix}`]
  );
  const orgId = org.rows[0].id;

  const event = await db.query<{ id: string }>(
    `INSERT INTO disaster_events (name, region, status) VALUES ($1, 'Testland', 'ACTIVE') RETURNING id`,
    [`Test Event ${suffix}`]
  );
  const eventId = event.rows[0].id;

  await db.query(`INSERT INTO event_partners (event_id, organization_id) VALUES ($1, $2)`, [eventId, orgId]);

  // POOL aid type — once per household, this event.
  const poolType = await db.query<{ id: string }>(
    `INSERT INTO aid_types (event_id, code, name, icon, resource_model)
     VALUES ($1, $2, 'Test Food', 'package', 'POOL') RETURNING id`,
    [eventId, `TEST_FOOD_${suffix}`]
  );
  const poolAidTypeId = poolType.rows[0].id;
  await db.query(
    `INSERT INTO aid_policies (aid_type_id, window_type, window_value, description)
     VALUES ($1, 'EVENT', NULL, 'one per household · this event')`,
    [poolAidTypeId]
  );
  await db.query(
    `INSERT INTO resource_pools (aid_type_id, event_id, distribution_point, total_quantity, remaining_quantity)
     VALUES ($1, $2, 'Test Hub', 5, 5)`,
    [poolAidTypeId, eventId]
  );

  // UNIT aid type — one named bed, the contested resource for the race test.
  const unitType = await db.query<{ id: string }>(
    `INSERT INTO aid_types (event_id, code, name, icon, resource_model)
     VALUES ($1, $2, 'Test Bed', 'bed-double', 'UNIT') RETURNING id`,
    [eventId, `TEST_BED_${suffix}`]
  );
  const unitAidTypeId = unitType.rows[0].id;
  await db.query(
    `INSERT INTO aid_policies (aid_type_id, window_type, window_value, description)
     VALUES ($1, 'EVENT', NULL, 'one per household · this event')`,
    [unitAidTypeId]
  );
  const bed = await db.query<{ id: string }>(
    `INSERT INTO resources (event_id, aid_type_id, label, status)
     VALUES ($1, $2, 'Bed T1', 'AVAILABLE') RETURNING id`,
    [eventId, unitAidTypeId]
  );
  const bedResourceId = bed.rows[0].id;

  async function cleanup(): Promise<void> {
    await db.query(`DELETE FROM audit_events WHERE event_id = $1`, [eventId]);
    await db.query(`DELETE FROM allocation_attempts WHERE event_id = $1`, [eventId]);
    await db.query(`DELETE FROM allocations WHERE event_id = $1`, [eventId]);
    await db.query(`DELETE FROM entitlement_claims WHERE event_id = $1`, [eventId]);
    await db.query(`DELETE FROM resources WHERE event_id = $1`, [eventId]);
    await db.query(`DELETE FROM resource_pools WHERE event_id = $1`, [eventId]);
    await db.query(`DELETE FROM aid_policies WHERE aid_type_id IN ($1, $2)`, [poolAidTypeId, unitAidTypeId]);
    await db.query(`DELETE FROM aid_types WHERE event_id = $1`, [eventId]);
    await db.query(`DELETE FROM households WHERE event_id = $1`, [eventId]);
    await db.query(`DELETE FROM event_partners WHERE event_id = $1`, [eventId]);
    await db.query(`DELETE FROM disaster_events WHERE id = $1`, [eventId]);
    await db.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
  }

  return { eventId, orgId, poolAidTypeId, unitAidTypeId, bedResourceId, cleanup };
}
