/**
 * scripts/seed.ts
 * ---------------------------------------------------------------------------
 * Populates a demo disaster event with organizations, aid types, and a real
 * slice of allocation history — run with: npm run db:seed
 *
 * Deliberately routes every allocation through the actual
 * `performAllocation()` engine (the same function /api/allocate calls)
 * rather than INSERTing fabricated rows directly. That means the seeded
 * "duplicates prevented" and "already taken" entries in the audit log are
 * real outcomes of the real unique-index and conditional-update mechanisms,
 * not decoration — open the app right after seeding and the dashboard
 * numbers, audit chain, and override queue are all genuinely earned.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../lib/db";
import { appendAuditEvent } from "../lib/audit";
import { describePolicy } from "../lib/policy";
import { performAllocation } from "../lib/allocation";
import { createOverrideRequest, decideOverride } from "../lib/overrides";
import { generateClaimCode, generateIdempotencyKey } from "../lib/ids";
import type { ResourceModel, WindowType } from "../lib/types";

async function createOrg(name: string, orgType: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, org_type) VALUES ($1,$2) RETURNING id`,
    [name, orgType]
  );
  return rows[0].id;
}

async function createAidType(
  eventId: string,
  code: string,
  name: string,
  icon: string,
  resourceModel: ResourceModel,
  windowType: WindowType,
  windowValue: number | null
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO aid_types (event_id, code, name, icon, resource_model) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [eventId, code, name, icon, resourceModel]
  );
  const aidTypeId = rows[0].id;
  const description = describePolicy(windowType, windowValue);
  await db.query(
    `INSERT INTO aid_policies (aid_type_id, window_type, window_value, description) VALUES ($1,$2,$3,$4)`,
    [aidTypeId, windowType, windowValue, description]
  );
  await appendAuditEvent(db, {
    eventId,
    action: "AID_TYPE_CREATED",
    actorName: "System",
    actorRole: "ADMIN",
    aidTypeId,
    detail: `${name} added — ${description}.`,
  });
  return aidTypeId;
}

async function createPool(aidTypeId: string, eventId: string, distributionPoint: string, total: number) {
  await db.query(
    `INSERT INTO resource_pools (aid_type_id, event_id, distribution_point, total_quantity, remaining_quantity)
     VALUES ($1,$2,$3,$4,$4)`,
    [aidTypeId, eventId, distributionPoint, total]
  );
}

async function createUnits(aidTypeId: string, eventId: string, labels: string[]) {
  for (const label of labels) {
    await db.query(`INSERT INTO resources (event_id, aid_type_id, label) VALUES ($1,$2,$3)`, [
      eventId,
      aidTypeId,
      label,
    ]);
  }
}

interface Worker {
  name: string;
  orgId: string;
  point: string;
}

export async function seedDemoData() {
  console.log(`Seeding AidLockIn demo data (backend: ${db.backend})...\n`);

  console.log("Creating organizations...");
  const hopeRelief = await createOrg("Hope Relief", "NGO");
  const kantoPrefecture = await createOrg("Kanto Prefecture", "GOV");
  const sakuraShelter = await createOrg("Sakura Shelter Network", "NGO");
  const mercyClinic = await createOrg("Mercy Clinic", "NGO");
  const redCrossJp = await createOrg("Red Cross JP", "NGO");
  const cityOfChiba = await createOrg("City of Chiba", "GOV");

  console.log("Creating disaster event...");
  const { rows: eventRows } = await db.query<{ id: string }>(
    `INSERT INTO disaster_events (name, region, status) VALUES ($1,$2,'ACTIVE') RETURNING id`,
    ["Typhoon Nari · Kanto Response", "Kanto, Japan"]
  );
  const eventId = eventRows[0].id;
  await appendAuditEvent(db, {
    eventId,
    action: "EVENT_CREATED",
    actorName: "System",
    actorRole: "ADMIN",
    detail: "Typhoon Nari · Kanto Response opened.",
  });

  const partners = [hopeRelief, kantoPrefecture, sakuraShelter, mercyClinic, redCrossJp, cityOfChiba];
  for (const orgId of partners) {
    await db.query(`INSERT INTO event_partners (event_id, organization_id) VALUES ($1,$2)`, [eventId, orgId]);
  }

  console.log("Creating aid types & policies...");
  const foodPack = await createAidType(eventId, "FOOD_PACK", "Food pack", "package", "POOL", "HOURS", 24);
  await createPool(foodPack, eventId, "Chiba Central Hub", 130);

  const cashVoucher = await createAidType(eventId, "CASH_VOUCHER", "Cash voucher", "banknote", "POOL", "DAYS", 7);
  await createPool(cashVoucher, eventId, "Chiba Central Hub", 80);

  const medicineKit = await createAidType(eventId, "MEDICINE_KIT", "Medicine kit", "syringe", "POOL", "DAYS", 3);
  await createPool(medicineKit, eventId, "Mercy Clinic Outpost", 60);

  const shelterBed = await createAidType(eventId, "SHELTER_BED", "Shelter bed", "bed-double", "UNIT", "ACTIVE", null);
  await createUnits(shelterBed, eventId, ["Bed A10", "Bed A11", "Bed A12", "Bed A13", "Bed A14"]);

  const transportSeat = await createAidType(eventId, "TRANSPORT_SEAT", "Transport seat", "bus", "UNIT", "EVENT", null);
  await createUnits(transportSeat, eventId, ["Seat 14F", "Seat 14G", "Seat 15A", "Seat 15B", "Seat 15C", "Seat 15D"]);

  console.log("Allocating sample history through the real engine...");
  const workers: Worker[] = [
    { name: "A. Yusuf", orgId: hopeRelief, point: "Chiba Central Hub" },
    { name: "K. Sato", orgId: kantoPrefecture, point: "Funabashi Relief Point" },
    { name: "R. Tanaka", orgId: sakuraShelter, point: "Narita Aid Station" },
    { name: "M. Chen", orgId: mercyClinic, point: "Mercy Clinic Outpost" },
    { name: "Y. Kobayashi", orgId: redCrossJp, point: "Kashiwa Distribution Center" },
  ];

  const householdCodes: string[] = Array.from({ length: 16 }, () => generateClaimCode());

  async function allocate(claimCode: string, aidTypeId: string, worker: Worker) {
    return performAllocation({
      eventId,
      claimCode,
      aidTypeId,
      organizationId: worker.orgId,
      workerName: worker.name,
      distributionPoint: worker.point,
      idempotencyKey: generateIdempotencyKey(),
      actorRole: "FIELD",
    });
  }

  for (let i = 0; i < householdCodes.length; i++) {
    const worker = workers[i % workers.length];
    await allocate(householdCodes[i], foodPack, worker);
    if (i % 2 === 0) await allocate(householdCodes[i], cashVoucher, worker);
    if (i % 3 === 0) await allocate(householdCodes[i], medicineKit, worker);
  }

  // Genuine duplicate denials: same household, same aid type, same policy
  // window, attempted again — exercising the real unique-index rejection.
  for (const i of [1, 4, 9]) {
    await allocate(householdCodes[i], foodPack, workers[(i + 1) % workers.length]);
  }

  // A handful of named-unit claims. Labels are picked alphabetically by the
  // engine, so "Bed A10" / "Bed A11" go first, leaving "Bed A12" free for
  // the race demo without any special-casing here.
  await allocate(householdCodes[2], shelterBed, workers[0]);
  await allocate(householdCodes[5], shelterBed, workers[1]);
  await allocate(householdCodes[6], transportSeat, workers[2]);
  await allocate(householdCodes[7], transportSeat, workers[3]);

  console.log("Creating override requests...");
  const pendingDenial = await allocate(householdCodes[1], foodPack, workers[2]);
  if (pendingDenial.result === "DENIED_DUPLICATE") {
    const overrideId = await createOverrideRequest({
      eventId,
      householdClaimCode: householdCodes[1],
      aidTypeId: foodPack,
      allocationAttemptId: pendingDenial.attemptId,
      requestedByOrgId: workers[2].orgId,
      requestedByName: workers[2].name,
      reason: "Household reports the first pack was ruined by floodwater before they could eat it.",
    });
    console.log(`  pending override created: ${overrideId}`);
  }

  const resolvedDenial = await allocate(householdCodes[4], cashVoucher, workers[3]);
  if (resolvedDenial.result === "DENIED_DUPLICATE") {
    const overrideId = await createOverrideRequest({
      eventId,
      householdClaimCode: householdCodes[4],
      aidTypeId: cashVoucher,
      allocationAttemptId: resolvedDenial.attemptId,
      requestedByOrgId: workers[3].orgId,
      requestedByName: workers[3].name,
      reason: "Second voucher requested after a documented bank card failure at the payout kiosk.",
    });
    await decideOverride({
      overrideId,
      decision: "APPROVED",
      decidedByName: "M. Tanaka",
      decisionNote: "Confirmed with finance desk before approving.",
      distributionPoint: workers[3].point,
    });
    console.log(`  resolved override created: ${overrideId}`);
  }

  console.log("\nSeed complete.");
  console.log(`  Event:        Typhoon Nari · Kanto Response (${eventId})`);
  console.log(`  Organizations: ${partners.length}`);
  console.log(`  Aid types:     5`);
  console.log(`  Households:    ${householdCodes.length}`);
}

// Run as a CLI script (npm run db:seed). When imported by the demo backend
// (lib/db.ts) this block is skipped and seedDemoData() is called directly.
const invokedDirectly = Boolean(process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1]));
if (invokedDirectly) {
  seedDemoData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
