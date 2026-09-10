// Shared session + authz helpers for server actions — one place instead
// of a copy-pasted requireAuthUserId() in every actions.ts file.

import { cache } from "react";
import { eq } from "drizzle-orm";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { users } from "@/db/schema";
import { can, type AuthzUser } from "@/lib/authz";
import { getActiveAdminRoles } from "@/lib/get-admin-roles";

type Db = Awaited<ReturnType<typeof getDb>>;

export async function requireAuthUserId(): Promise<string> {
  const userId = await getVerifiedUserId();
  if (!userId) throw new Error("Not signed in");
  return userId;
}

/**
 * Full AuthzUser for the signed-in therapist — includes admin roles when present.
 *
 * The two queries are independent (getActiveAdminRoles needs only userId), so
 * they go out together rather than one behind the other — one round trip of
 * latency instead of two, which matters because every trip crosses to the
 * database region. `cache()` dedupes repeat calls within a single request.
 */
export const loadAuthzUser = cache(async (db: Db, userId: string): Promise<AuthzUser> => {
  const [rows, adminRoles] = await Promise.all([
    db
      .select({
        accountType: users.accountType,
        verificationStage: users.verificationStage,
        contactDisclosureHoldUntil: users.contactDisclosureHoldUntil,
      })
      .from(users)
      .where(eq(users.id, userId)),
    getActiveAdminRoles(db, userId),
  ]);
  const [me] = rows;
  if (!me) throw new Error("User not found");

  return {
    id: userId,
    accountType: me.accountType,
    verificationStage: me.verificationStage,
    adminRoles,
    contactDisclosureHoldUntil: me.contactDisclosureHoldUntil,
  };
});

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
  const userId = await getVerifiedUserId();
  if (!userId) throw new Error("Not signed in");

  const db = await getDb();
  const [profile] = await db.select().from(users).where(eq(users.id, userId));
  if (!profile) throw new Error("No profile found for this account");

  return { db, userId, profile };
}
