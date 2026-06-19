import { NextRequest, NextResponse } from "next/server";
import { fetchAuditFeed } from "@/lib/audit";
import { jsonError } from "@/lib/api";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) return jsonError("eventId is required");

  try {
    const rows = await fetchAuditFeed(eventId);
    const header = ["Entry", "Timestamp", "Action", "Actor", "Role", "Organization", "Household", "Aid type", "Detail", "Hash"];
    const lines = [header.join(",")];
    for (const row of rows) {
      lines.push(
        [
          row.audit_no,
          new Date(row.created_at).toISOString(),
          row.action,
          row.actor_name,
          row.actor_role,
          row.organization_name,
          row.household_claim_code,
          row.aid_type_name,
          row.detail,
          row.hash,
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    return new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="aidlockin-audit-log.csv"`,
      },
    });
  } catch (err) {
    console.error(err);
    return jsonError(err instanceof Error ? err.message : "Export failed", 500);
  }
}
