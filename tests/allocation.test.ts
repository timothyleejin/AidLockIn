import { describe, it, expect, afterEach } from "vitest";
import { hasDb, setupTestEvent, type TestEvent } from "./db";
import { performAllocation, type PerformAllocationInput } from "@/lib/allocation";
import { db } from "@/lib/db";
import { generateClaimCode, generateIdempotencyKey } from "@/lib/ids";

function req(
  over: Pick<PerformAllocationInput, "eventId" | "claimCode" | "aidTypeId" | "organizationId"> &
    Partial<PerformAllocationInput>
): PerformAllocationInput {
  return {
    workerName: "Test Worker",
    distributionPoint: "Test Hub",
    actorRole: "FIELD",
    idempotencyKey: generateIdempotencyKey(),
    ...over,
  };
}

describe.skipIf(!hasDb)("allocation hero guarantees", () => {
  let env: TestEvent | undefined;
  afterEach(async () => {
    if (env) await env.cleanup();
    env = undefined;
  });

  it("blocks a duplicate entitlement within the policy window", async () => {
    env = await setupTestEvent();
    const claimCode = generateClaimCode();

    const first = await performAllocation(
      req({ eventId: env.eventId, claimCode, aidTypeId: env.poolAidTypeId, organizationId: env.orgId })
    );
    expect(first.result).toBe("APPROVED");

    const second = await performAllocation(
      req({ eventId: env.eventId, claimCode, aidTypeId: env.poolAidTypeId, organizationId: env.orgId })
    );
    expect(second.result).toBe("DENIED_DUPLICATE");

    // The unique index — not application logic — is what guarantees this.
    const claims = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM entitlement_claims WHERE event_id = $1 AND aid_type_id = $2`,
      [env.eventId, env.poolAidTypeId]
    );
    expect(Number(claims.rows[0].count)).toBe(1);
  });

  it("lets exactly one of two concurrent stations win the same bed", async () => {
    env = await setupTestEvent();

    const outcomes = await Promise.all([
      performAllocation(
        req({
          eventId: env.eventId,
          claimCode: generateClaimCode(),
          aidTypeId: env.unitAidTypeId,
          organizationId: env.orgId,
          targetResourceId: env.bedResourceId,
        })
      ),
      performAllocation(
        req({
          eventId: env.eventId,
          claimCode: generateClaimCode(),
          aidTypeId: env.unitAidTypeId,
          organizationId: env.orgId,
          targetResourceId: env.bedResourceId,
        })
      ),
    ]);

    const results = outcomes.map((o) => o.result);
    expect(results.filter((r) => r === "APPROVED")).toHaveLength(1);
    expect(results).toContain("DENIED_RESOURCE_TAKEN");

    const bed = await db.query<{ status: string }>(`SELECT status FROM resources WHERE id = $1`, [
      env.bedResourceId,
    ]);
    expect(bed.rows[0].status).toBe("ALLOCATED");
  });
});
