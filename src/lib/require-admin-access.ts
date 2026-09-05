// Shared page- and action-level admin access check for Phase 10 screens.
// Earlier admin surfaces (verification, practice-claims) only gate inside
// their server actions, not the page component itself — a real gap
// relative to §8G6's "nobody sees a section they don't hold a role for."
// New sensitive screens (Team & Roles, Grievance) use this at the page
// level too, via redirect() rather than a thrown error, since an admin
// without the role should land somewhere sane, not see a crash screen.

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { getActiveAdminRoles } from "@/lib/get-admin-roles";
import { can, type Action } from "@/lib/authz";
import { adminUsers } from "@/db/schema";

type Db = Awaited<ReturnType<typeof getDb>>;

export interface AdminAccess {
  db: Db;
  userId: string;
  adminUserId: string;
  adminRoles: string[];
}

/** Throws — for use inside server actions, where a thrown error is the
 * right failure mode (the action just doesn't apply). */
export async function requireAdminAccess(action: Action): Promise<AdminAccess> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) throw new Error("Not signed in");

  const db = await getDb();
  const adminRoles = await getActiveAdminRoles(db, authUser.id);

  const result = can(
    {
      id: authUser.id,
      accountType: "therapist",
      verificationStage: "unverified",
      adminRoles,
      contactDisclosureHoldUntil: null,
    },
    action,
  );
  if (!result.allowed) throw new Error(result.reason);

  const [adminUser] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.userId, authUser.id));
  if (!adminUser) throw new Error("Acting user has no admin_users row");

  return { db, userId: authUser.id, adminUserId: adminUser.id, adminRoles };
}

/** Redirects to /admin — for use first thing inside a page component, so an
 * admin who lacks the role for this specific section lands on the nav
 * instead of a thrown error. */
export async function requireAdminAccessOrRedirect(action: Action): Promise<AdminAccess> {
  try {
    return await requireAdminAccess(action);
  } catch {
    redirect("/admin");
  }
}
