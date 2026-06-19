import { db } from "@/lib/db";
import { withErrorHandling } from "@/lib/api";
import type { Organization } from "@/lib/types";

export async function GET() {
  return withErrorHandling(async () => {
    const { rows } = await db.query<Organization>(
      `SELECT id, name, org_type, created_at FROM organizations ORDER BY name ASC`
    );
    return rows;
  });
}
