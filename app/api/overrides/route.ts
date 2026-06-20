import { NextRequest } from "next/server";
import { createOverrideRequest, listOverrideRequests } from "@/lib/overrides";
import { jsonError, requireString, withErrorHandling } from "@/lib/api";

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) return jsonError("eventId is required");
  return withErrorHandling(() => listOverrideRequests(eventId));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Invalid JSON body");

  return withErrorHandling(async () => {
    const eventId = requireString(body.eventId, "eventId");
    const householdClaimCode = requireString(body.householdClaimCode, "householdClaimCode").toUpperCase();
    const aidTypeId = requireString(body.aidTypeId, "aidTypeId");
    const requestedByOrgId = requireString(body.requestedByOrgId, "requestedByOrgId");
    const requestedByName = requireString(body.requestedByName, "requestedByName");
    const reason = requireString(body.reason, "reason");
    const allocationAttemptId = typeof body.allocationAttemptId === "string" ? body.allocationAttemptId : null;

    const id = await createOverrideRequest({
      eventId,
      householdClaimCode,
      aidTypeId,
      allocationAttemptId,
      requestedByOrgId,
      requestedByName,
      reason,
    });
    return { id };
  });
}
