import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fetchAuditFeed } from "@/lib/audit";
import { jsonError, withErrorHandling } from "@/lib/api";
import type { StatsResponse } from "@/lib/types";

// A pool is "low" once a quarter or less of its original stock remains —
// the same 25% threshold the /pools progress bars flip to red at.
const LOW_STOCK_PCT = 25;

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) return jsonError("eventId is required");

  return withErrorHandling(async (): Promise<StatsResponse> => {
    const [householdsHelped, duplicatesPrevented, partnerOrgs, totalAllocations, pendingOverrides, byAidType, lowStock, recentActivity] =
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
        db.query<{ name: string; icon: string; remaining_quantity: number; total_quantity: number }>(
          `SELECT at.name, at.icon, rp.remaining_quantity, rp.total_quantity
           FROM resource_pools rp
           JOIN aid_types at ON at.id = rp.aid_type_id
           WHERE rp.event_id = $1 AND rp.total_quantity > 0
             AND rp.remaining_quantity * 100 <= rp.total_quantity * $2
           ORDER BY rp.remaining_quantity::float / rp.total_quantity ASC`,
          [eventId, LOW_STOCK_PCT]
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
      lowStock: lowStock.rows.map((r) => ({
        aidTypeName: r.name,
        icon: r.icon,
        remaining: Number(r.remaining_quantity),
        total: Number(r.total_quantity),
      })),
      recentActivity,
    };
  });
}
