import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fetchAuditFeed } from "@/lib/audit";
import { jsonError, withErrorHandling } from "@/lib/api";
import type { StatsResponse } from "@/lib/types";

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) return jsonError("eventId is required");

  return withErrorHandling(async (): Promise<StatsResponse> => {
    const [householdsHelped, duplicatesPrevented, partnerOrgs, totalAllocations, pendingOverrides, byAidType, recentActivity] =
      await Promise.all([
        db
          .query<{ count: string }>(
            `SELECT COUNT(DISTINCT household_id) AS count FROM allocations WHERE event_id = $1`,
            [eventId]
          )
          .then((r) => Number(r.rows[0]?.count ?? 0)),
        db
          .query<{ count: string }>(
            `SELECT COUNT(*) AS count FROM allocation_attempts WHERE event_id = $1 AND result = 'DENIED_DUPLICATE'`,
            [eventId]
          )
          .then((r) => Number(r.rows[0]?.count ?? 0)),
        db
          .query<{ count: string }>(`SELECT COUNT(*) AS count FROM event_partners WHERE event_id = $1`, [eventId])
          .then((r) => Number(r.rows[0]?.count ?? 0)),
        db
          .query<{ count: string }>(`SELECT COUNT(*) AS count FROM allocations WHERE event_id = $1`, [eventId])
          .then((r) => Number(r.rows[0]?.count ?? 0)),
        db
          .query<{ count: string }>(
            `SELECT COUNT(*) AS count FROM override_requests WHERE event_id = $1 AND status = 'PENDING'`,
            [eventId]
          )
          .then((r) => Number(r.rows[0]?.count ?? 0)),
        db.query<{ id: string; name: string; icon: string; approved: string; denied: string }>(
          `SELECT at.id, at.name, at.icon,
                  (SELECT COUNT(*) FROM allocations al WHERE al.aid_type_id = at.id) AS approved,
                  (SELECT COUNT(*) FROM allocation_attempts att WHERE att.aid_type_id = at.id AND att.result LIKE 'DENIED%') AS denied
           FROM aid_types at
           WHERE at.event_id = $1
           ORDER BY at.name ASC`,
          [eventId]
        ),
        fetchAuditFeed(eventId, 8),
      ]);

    return {
      householdsHelped,
      duplicatesPrevented,
      partnerOrgs,
      totalAllocations,
      pendingOverrides,
      byAidType: byAidType.rows.map((r) => ({
        aidTypeName: r.name,
        icon: r.icon,
        approved: Number(r.approved),
        denied: Number(r.denied),
      })),
      recentActivity,
    };
  });
}
