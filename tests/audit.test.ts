import { describe, it, expect, afterEach } from "vitest";
import { hasDb, setupTestEvent, type TestEvent } from "./db";
import { appendAuditEvent, verifyAuditChain } from "@/lib/audit";
import { db } from "@/lib/db";

describe.skipIf(!hasDb)("audit chain integrity", () => {
  let env: TestEvent | undefined;
  afterEach(async () => {
    if (env) await env.cleanup();
    env = undefined;
  });

  it("verifies a clean chain and detects a tampered row", async () => {
    env = await setupTestEvent();

    for (let i = 0; i < 3; i++) {
      await appendAuditEvent(db, {
        eventId: env.eventId,
        action: "EVENT_CREATED",
        detail: `entry ${i}`,
        actorName: "Tester",
        actorRole: "ADMIN",
      });
    }
    expect(await verifyAuditChain(env.eventId)).toBe(true);

    // Editing a historical row changes the bytes its hash committed to, which
    // must break verification for it and everything chained after it.
    const target = await db.query<{ id: string }>(
      `SELECT id FROM audit_events WHERE event_id = $1 ORDER BY audit_no ASC LIMIT 1`,
      [env.eventId]
    );
    await db.query(`UPDATE audit_events SET detail = 'tampered' WHERE id = $1`, [target.rows[0].id]);

    expect(await verifyAuditChain(env.eventId)).toBe(false);
  });
});
