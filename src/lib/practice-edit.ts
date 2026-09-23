// Phase 3 — practice profile editing (§8C2). Ownership is resource-
// specific (a practice_users row, not a role), so it's checked directly
// against the DB here rather than through can() — same convention as
// circles.ts's requireOwnedCircle, referenced in authz.ts's own comment
// on post_to_community for why this class of check lives with its data.

import { and, eq, isNull } from "drizzle-orm";
import type { getDb } from "@/db/db";
import { practices, practiceUsers } from "@/db/schema";

type Db = Awaited<ReturnType<typeof getDb>>;

/** Throws if the caller isn't an active owner/manager of this practice.
 * Never lets a 'staff' (works_at, self-asserted) affiliation edit the
 * practice record — only owner/manager access roles can. */
export async function requirePracticeEditor(db: Db, practiceId: string, userId: string): Promise<void> {
  const [row] = await db
    .select({ accessRole: practiceUsers.accessRole })
    .from(practiceUsers)
    .where(
      and(
        eq(practiceUsers.practiceId, practiceId),
        eq(practiceUsers.userId, userId),
        eq(practiceUsers.status, "active"),
        isNull(practiceUsers.endedAt),
        isNull(practiceUsers.deletedAt),
      ),
    );
  if (!row || !["owner", "manager"].includes(row.accessRole)) {
    throw new Error("Only an owner or manager of this practice can edit it");
  }
}

export interface PracticeEditInput {
  bio?: string;
  servicesOffered?: string[];
  specialties?: string[];
  websiteUrl?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
  coverImageUrl?: string;
}

export async function updatePracticeTx(
  db: Db,
  practiceId: string,
  userId: string,
  input: PracticeEditInput,
): Promise<void> {
  await requirePracticeEditor(db, practiceId, userId);

  await db
    .update(practices)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(practices.id, practiceId));
}
