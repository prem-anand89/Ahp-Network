// §8A / §10A — how a users row comes into existence. Called from the OAuth
// callback route and the OTP-verify server action, never from a database
// trigger: this needs to set account_type and is_founding_member, and a
// server action is testable, debuggable, and reviewable in a way a trigger
// is not. Also upserts auth_identities from Supabase Auth's own identity
// records — this table remains the AHP-specific mapping regardless of
// which provider issued the session.

import { eq, and } from "drizzle-orm";
import type { getDb } from "@/db/db";
import { users, authIdentities } from "@/db/schema";
import { acceptInviteTx } from "@/lib/invites";

type Db = Awaited<ReturnType<typeof getDb>>;

// §10A — true for every account created before the §14 go/no-go review.
// Flip to false once that review actually happens; this is a real business
// decision with a date attached to it, not a permanent default.
const FOUNDING_COHORT_OPEN = true;

interface SupabaseIdentity {
  provider: string;
  id: string;
}

interface SupabaseAuthUser {
  id: string;
  email?: string;
  identities?: SupabaseIdentity[] | null;
}

function normalizeProvider(provider: string): "google" | "email" {
  return provider === "google" ? "google" : "email";
}

// `db` is injected rather than obtained via getDb() internally — getDb()
// needs a real Cloudflare Workers context (Hyperdrive binding), which
// doesn't exist in a Vitest run. The caller (the OAuth callback route, the
// OTP-verify server action) gets its db from getDb(); tests pass a plain
// drizzle client against local Postgres. Same function either way.
export async function ensureUserAndIdentities(
  db: Db,
  authUser: SupabaseAuthUser,
  /** §8A4 — a `?ref=<code>` captured before auth (see the login/OAuth call
   * sites). Only meaningful on the row's first insert; onConflictDoNothing
   * below already makes this function safe to call on every sign-in. */
  invitedByCode?: string | null,
): Promise<void> {
  if (!authUser.email) {
    throw new Error("Cannot create a users row without an email");
  }

  const [inserted] = await db
    .insert(users)
    .values({
      id: authUser.id,
      email: authUser.email,
      accountType: "therapist",
      isFoundingMember: FOUNDING_COHORT_OPEN,
    })
    .onConflictDoNothing({ target: users.id })
    .returning({ id: users.id });

  if (inserted && invitedByCode) {
    await acceptInviteTx(db, invitedByCode, authUser.id);
  }

  for (const identity of authUser.identities ?? []) {
    const provider = normalizeProvider(identity.provider);

    const [existing] = await db
      .select({ id: authIdentities.id })
      .from(authIdentities)
      .where(
        and(
          eq(authIdentities.provider, provider),
          eq(authIdentities.providerAccountId, identity.id),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(authIdentities)
        .set({ lastUsedAt: new Date() })
        .where(eq(authIdentities.id, existing.id));
    } else {
      await db.insert(authIdentities).values({
        userId: authUser.id,
        provider,
        providerAccountId: identity.id,
        emailAtLink: authUser.email,
        lastUsedAt: new Date(),
      });
    }
  }
}
