import { NextRequest } from "next/server";
import { fetchAuditFeed, verifyAuditChain } from "@/lib/audit";
import { jsonError, withErrorHandling } from "@/lib/api";

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) return jsonError("eventId is required");

  return withErrorHandling(async () => {
    const [events, verified] = await Promise.all([fetchAuditFeed(eventId), verifyAuditChain(eventId)]);
    return { events, verified };
  });
}
