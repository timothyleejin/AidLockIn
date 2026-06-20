import { NextRequest } from "next/server";
import { performAllocation } from "@/lib/allocation";
import { jsonError, requireString, withErrorHandling } from "@/lib/api";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Invalid JSON body");

  return withErrorHandling(async () => {
    const eventId = requireString(body.eventId, "eventId");
    const claimCode = requireString(body.claimCode, "claimCode").toUpperCase();
    const aidTypeId = requireString(body.aidTypeId, "aidTypeId");
    const organizationId = requireString(body.organizationId, "organizationId");
    const workerName = requireString(body.workerName, "workerName");
    const distributionPoint = requireString(body.distributionPoint, "distributionPoint");
    const idempotencyKey = requireString(body.idempotencyKey, "idempotencyKey");
    const actorRole = requireString(body.actorRole, "actorRole");
    const simulatedRegion = typeof body.simulatedRegion === "string" ? body.simulatedRegion : undefined;
    const targetResourceId = typeof body.targetResourceId === "string" ? body.targetResourceId : undefined;

    return performAllocation({
      eventId,
      claimCode,
      aidTypeId,
      organizationId,
      workerName,
      distributionPoint,
      idempotencyKey,
      actorRole,
      simulatedRegion,
      targetResourceId,
    });
  });
}
