import { NextRequest } from "next/server";
import { runRaceDemo } from "@/lib/race-demo";
import { jsonError, requireString, withErrorHandling } from "@/lib/api";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Invalid JSON body");

  return withErrorHandling(async () => {
    const eventId = requireString(body.eventId, "eventId");
    const aidTypeId = requireString(body.aidTypeId, "aidTypeId");
    return runRaceDemo(eventId, aidTypeId);
  });
}
