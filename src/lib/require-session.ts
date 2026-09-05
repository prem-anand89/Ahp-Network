// Shared session + authz helpers for server actions — one place instead
// of a copy-pasted requireAuthUserId() in every actions.ts file.

import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { users } from "@/db/schema";
import { can, type AuthzUser } from "@/lib/authz";
import { getActiveAdminRoles } from "@/lib/get-admin-roles";

type Db = Awaited<ReturnType<typeof getDb>>;

export async function requireAuthUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

/** Full AuthzUser for the signed-in therapist — includes admin roles when present. */
export async function loadAuthzUser(db: Db, userId: string): Promise<AuthzUser> {
  const [me] = await db
    .select({
      accountType: users.accountType,
      verificationStage: users.verificationStage,
      contactDisclosureHoldUntil: users.contactDisclosureHoldUntil,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!me) throw new Error("User not found");

  const adminRoles = await getActiveAdminRoles(db, userId);

  return {
    id: userId,
    accountType: me.accountType,
    verificationStage: me.verificationStage,
    adminRoles,
    contactDisclosureHoldUntil: me.contactDisclosureHoldUntil,
  };
}

export async function requireAuthzUser(): Promise<{ userId: string; authz: AuthzUser; db: Db }> {
  const userId = await requireAuthUserId();
  const db = await getDb();
  const authz = await loadAuthzUser(db, userId);
  return { userId, authz, db };
}

/** §8A — profile and credential mutations on the viewer's own row only. */
export async function requireEditOwnProfile(): Promise<{ userId: string; db: Db }> {
  const { userId, authz, db } = await requireAuthzUser();
  const result = can(authz, { type: "edit_own_profile", targetUserId: userId });
  if (!result.allowed) throw new Error(result.reason);
  return { userId, db };
}

export async function requireAuthedTherapist() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) throw new Error("Not signed in");

  const db = await getDb();
  const [profile] = await db.select().from(users).where(eq(users.id, authUser.id));
  if (!profile) throw new Error("No profile found for this account");

  return { db, authUser, profile };
}
