import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/lib/audit";
import { describePolicy } from "@/lib/policy";
import { jsonError, requireString, withErrorHandling } from "@/lib/api";
import type { AidType, ResourceModel, WindowType } from "@/lib/types";

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) return jsonError("eventId is required");

  return withErrorHandling(async () => {
    const { rows: aidTypes } = await db.query<{
      id: string;
      event_id: string;
      code: string;
      name: string;
      icon: string;
      resource_model: ResourceModel;
      window_type: WindowType;
      window_value: number | null;
      policy_description: string;
    }>(
      `SELECT at.id, at.event_id, at.code, at.name, at.icon, at.resource_model,
              ap.window_type, ap.window_value, ap.description AS policy_description
       FROM aid_types at
       JOIN aid_policies ap ON ap.aid_type_id = at.id
       WHERE at.event_id = $1
       ORDER BY at.name ASC`,
      [eventId]
    );

    const { rows: pools } = await db.query<{
      id: string;
      aid_type_id: string;
      total_quantity: number;
      remaining_quantity: number;
    }>(`SELECT id, aid_type_id, total_quantity, remaining_quantity FROM resource_pools WHERE event_id = $1`, [
      eventId,
    ]);
    const poolByAidType = new Map(pools.map((p) => [p.aid_type_id, p]));

    const { rows: units } = await db.query<{
      id: string;
      aid_type_id: string;
      label: string;
      status: string;
    }>(`SELECT id, aid_type_id, label, status FROM resources WHERE event_id = $1 ORDER BY label ASC`, [
      eventId,
    ]);

    const result: AidType[] = aidTypes.map((row) => {
      const base: AidType = { ...row };
      if (row.resource_model === "POOL") {
        const pool = poolByAidType.get(row.id);
        base.pool_id = pool?.id ?? null;
        base.total_quantity = pool?.total_quantity ?? 0;
        base.remaining_quantity = pool?.remaining_quantity ?? 0;
      } else {
        const ofType = units.filter((u) => u.aid_type_id === row.id);
        base.available_units = ofType.filter((u) => u.status === "AVAILABLE").map((u) => ({ id: u.id, label: u.label }));
        base.available_count = base.available_units.length;
        base.allocated_count = ofType.length - base.available_units.length;
      }
      return base;
    });

    return result;
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Invalid JSON body");

  return withErrorHandling(async () => {
    const eventId = requireString(body.eventId, "eventId");
    const code = requireString(body.code, "code").toUpperCase().replace(/\s+/g, "_");
    const name = requireString(body.name, "name");
    const icon = requireString(body.icon, "icon");
    const resourceModel: ResourceModel = body.resourceModel === "UNIT" ? "UNIT" : "POOL";
    const windowType: WindowType = ["HOURS", "DAYS", "EVENT", "ACTIVE"].includes(body.windowType)
      ? body.windowType
      : "EVENT";
    const windowValue =
      windowType === "HOURS" || windowType === "DAYS" ? Number(body.windowValue) || null : null;

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO aid_types (event_id, code, name, icon, resource_model) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [eventId, code, name, icon, resourceModel]
    );
    const aidTypeId = rows[0].id;
    const description = describePolicy(windowType, windowValue);

    await db.query(
      `INSERT INTO aid_policies (aid_type_id, window_type, window_value, description) VALUES ($1,$2,$3,$4)`,
      [aidTypeId, windowType, windowValue, description]
    );

    if (resourceModel === "POOL") {
      const totalQuantity = Number(body.totalQuantity) || 0;
      const distributionPoint = typeof body.distributionPoint === "string" ? body.distributionPoint : null;
      await db.query(
        `INSERT INTO resource_pools (aid_type_id, event_id, distribution_point, total_quantity, remaining_quantity)
         VALUES ($1,$2,$3,$4,$4)`,
        [aidTypeId, eventId, distributionPoint, totalQuantity]
      );
    } else {
      const unitLabels: string[] = Array.isArray(body.unitLabels)
        ? body.unitLabels.filter((l: unknown) => typeof l === "string" && l.trim().length > 0)
        : [];
      for (const label of unitLabels) {
        await db.query(`INSERT INTO resources (event_id, aid_type_id, label) VALUES ($1,$2,$3)`, [
          eventId,
          aidTypeId,
          label.trim(),
        ]);
      }
    }

    await appendAuditEvent(db, {
      eventId,
      action: "AID_TYPE_CREATED",
      actorName: typeof body.actorName === "string" ? body.actorName : "System",
      actorRole: typeof body.actorRole === "string" ? body.actorRole : "ADMIN",
      aidTypeId,
      detail: `${name} added — ${description}.`,
    });

    return { id: aidTypeId };
  });
}
