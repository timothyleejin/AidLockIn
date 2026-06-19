import { NextRequest } from "next/server";
import { decideOverride } from "@/lib/overrides";
import { jsonError, requireString, withErrorHandling } from "@/lib/api";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Invalid JSON body");

  return withErrorHandling(async () => {
    const overrideId = requireString(body.id ?? body.overrideId, "id");
    const decision = body.decision === "REJECTED" ? "REJECTED" : "APPROVED";
    const decidedByName = requireString(body.decidedByName, "decidedByName");
    const distributionPoint = requireString(body.distributionPoint, "distributionPoint");
    const decisionNote = typeof body.decisionNote === "string" ? body.decisionNote : undefined;

    return decideOverride({
      overrideId,
      decision,
      decidedByName,
      decisionNote,
      distributionPoint,
    });
  });
}
