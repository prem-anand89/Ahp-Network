import { eq, isNull, and } from "drizzle-orm";
import type { getDb } from "@/db/db";
import { adminUsers, adminUserRoles } from "@/db/schema";

type Db = Awaited<ReturnType<typeof getDb>>;

/** Active (non-revoked) admin_user_roles for a given users.id, empty if not an admin. */
export async function getActiveAdminRoles(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ role: adminUserRoles.role })
    .from(adminUserRoles)
    .innerJoin(adminUsers, eq(adminUserRoles.adminUserId, adminUsers.id))
    .where(and(eq(adminUsers.userId, userId), isNull(adminUserRoles.revokedAt)));

  return rows.map((r) => r.role);
}
