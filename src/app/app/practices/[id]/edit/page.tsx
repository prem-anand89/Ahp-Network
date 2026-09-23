// Phase 3 — /app/practices/[id]/edit. Gated to an accepted owner/manager
// affiliation (requirePracticeEditor) — a self-asserted 'staff' row never
// gets here, matching §8C's "creating never owns."

import { notFound } from "next/navigation";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { practices, practiceUsers, users } from "@/db/schema";
import { eq, isNull, and } from "drizzle-orm";
import { requirePracticeEditor } from "@/lib/practice-edit";
import { PracticeEditForm } from "./practice-edit-form";
import { PracticeTeamSection } from "./practice-team-section";

export const dynamic = "force-dynamic";

export default async function EditPracticePage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getVerifiedUserId();
  if (!userId) return null;

  const { id } = await params;
  const db = await getDb();

  const [practice] = await db
    .select()
    .from(practices)
    .where(and(eq(practices.id, id), isNull(practices.deletedAt)));
  if (!practice) notFound();

  try {
    await requirePracticeEditor(db, id, userId);
  } catch {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <p className="text-sm text-muted-foreground">
          Only an owner or manager of this practice can edit it.
        </p>
      </main>
    );
  }

  const members = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      accessRole: practiceUsers.accessRole,
      assertedBy: practiceUsers.assertedBy,
    })
    .from(practiceUsers)
    .innerJoin(users, eq(users.id, practiceUsers.userId))
    .where(and(eq(practiceUsers.practiceId, id), eq(practiceUsers.status, "active"), isNull(practiceUsers.deletedAt)))
    .orderBy(practiceUsers.createdAt);

  const requests = await db
    .select({ userId: users.id, displayName: users.displayName })
    .from(practiceUsers)
    .innerJoin(users, eq(users.id, practiceUsers.userId))
    .where(and(eq(practiceUsers.practiceId, id), eq(practiceUsers.status, "requested"), isNull(practiceUsers.deletedAt)))
    .orderBy(practiceUsers.createdAt);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Edit {practice.name}</h1>
      <div className="mt-6">
        <PracticeEditForm
          practiceId={practice.id}
          initial={{
            bio: practice.bio ?? "",
            servicesOffered: (practice.servicesOffered ?? []).join(", "),
            specialties: (practice.specialties ?? []).join(", "),
            websiteUrl: practice.websiteUrl ?? "",
            phone: practice.phone ?? "",
            email: practice.email ?? "",
            logoUrl: practice.logoUrl,
            coverImageUrl: practice.coverImageUrl,
          }}
        />
      </div>
      <div className="mt-10">
        <PracticeTeamSection
          practiceId={practice.id}
          viewerUserId={userId}
          members={members}
          requests={requests}
        />
      </div>
    </main>
  );
}
