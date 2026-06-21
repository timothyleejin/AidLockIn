import { NextRequest } from "next/server";
import { detectDuplicatePatterns } from "@/lib/patterns";
import { jsonError, withErrorHandling } from "@/lib/api";

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) return jsonError("eventId is required");

  return withErrorHandling(() => detectDuplicatePatterns(eventId));
}
