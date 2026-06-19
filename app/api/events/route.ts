import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/lib/audit";
import { jsonError, requireString, withErrorHandling } from "@/lib/api";
import type { DisasterEvent } from "@/lib/types";

export async function GET() {
  return withErrorHandling(async () => {
    const { rows } = await db.query<DisasterEvent & { partner_count: string }>(
      `SELECT de.id, de.name, de.region, de.status, de.created_at,
              (SELECT COUNT(*) FROM event_partners ep WHERE ep.event_id = de.id) AS partner_count
       FROM disaster_events de
       ORDER BY de.created_at DESC`
    );
    return rows.map((row) => ({ ...row, partner_count: Number(row.partner_count) }));
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Invalid JSON body");

  return withErrorHandling(async () => {
    const name = requireString(body.name, "name");
    const region = typeof body.region === "string" ? body.region.trim() : null;
    const status = body.status === "CLOSED" ? "CLOSED" : "ACTIVE";
    const partnerOrgIds: string[] = Array.isArray(body.partnerOrgIds) ? body.partnerOrgIds : [];

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO disaster_events (name, region, status) VALUES ($1,$2,$3) RETURNING id`,
      [name, region, status]
    );
    const eventId = rows[0].id;

    for (const orgId of partnerOrgIds) {
      await db.query(`INSERT INTO event_partners (event_id, organization_id) VALUES ($1,$2)`, [
        eventId,
        orgId,
      ]);
    }

    await appendAuditEvent(db, {
      eventId,
      action: "EVENT_CREATED",
      actorName: typeof body.actorName === "string" ? body.actorName : "System",
      actorRole: typeof body.actorRole === "string" ? body.actorRole : "ADMIN",
      detail: `${name} opened with ${partnerOrgIds.length} partner organization${partnerOrgIds.length === 1 ? "" : "s"}.`,
    });

    return { id: eventId };
  });
}
