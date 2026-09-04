"use server";

// Phase 2 curation queues — plan §8B (courses), §8B2 (institutions),
// §8A1a (councils). All three share one admin habit: approve links/confirms
// a pending entry, reject removes it, neither ever happens automatically
// regardless of fuzzy-match or OCR confidence (CLAUDE.md
// non-negotiables). Gated on manage_curation_queue (src/lib/authz.ts) —
// verification_admin or super_admin, same reasoning §8G6 gives the Phase 3
// verification queue and Phase 4's practice-claim queue.

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { getActiveAdminRoles } from "@/lib/get-admin-roles";
import { can } from "@/lib/authz";
import { courseCompletions, masterInstitutions, masterCouncils } from "@/db/schema";

async function requireCurationAccess() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    throw new Error("Not signed in");
  }

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
    { type: "manage_curation_queue" },
  );

  if (!result.allowed) {
    throw new Error(result.reason);
  }

  return db;
}

// --- Courses -----------------------------------------------------------
// A pending row's custom_course_name/provider_name came from the
// therapist's own submission — "approve" here means "link to an existing
// master row," never "invent one from the free text." A genuinely new
// course still needs its own master_courses_certifications row created by
// an admin first (out of scope for this thin queue action).

export async function approveCourseCompletion(id: string, masterCourseId: string) {
  const db = await requireCurationAccess();
  await db
    .update(courseCompletions)
    .set({ masterCourseId, curationStatus: "approved", updatedAt: new Date() })
    .where(eq(courseCompletions.id, id));
  revalidatePath("/admin/curation/courses");
}

export async function rejectCourseCompletion(id: string) {
  const db = await requireCurationAccess();
  await db
    .update(courseCompletions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(courseCompletions.id, id));
  revalidatePath("/admin/curation/courses");
}

// --- Institutions --------------------------------------------------------

export async function approveInstitution(id: string) {
  const db = await requireCurationAccess();
  await db
    .update(masterInstitutions)
    .set({ curationStatus: "approved" })
    .where(eq(masterInstitutions.id, id));
  revalidatePath("/admin/curation/institutions");
}

export async function rejectInstitution(id: string) {
  const db = await requireCurationAccess();
  await db
    .update(masterInstitutions)
    .set({ isActive: false, curationStatus: "approved" })
    .where(eq(masterInstitutions.id, id));
  revalidatePath("/admin/curation/institutions");
}

// --- Councils ------------------------------------------------------------
// §8A1a: never auto-created regardless of match confidence, hand-curated only.
// This action is the human decision point for a state council proposed
// after the pilot's 3-row hand-seed — approving one is a real regulatory
// judgment, not a data-entry convenience.

export async function approveCouncil(id: string) {
  const db = await requireCurationAccess();
  await db
    .update(masterCouncils)
    .set({ curationStatus: "approved" })
    .where(eq(masterCouncils.id, id));
  revalidatePath("/admin/curation/councils");
}

export async function rejectCouncil(id: string) {
  const db = await requireCurationAccess();
  await db
    .update(masterCouncils)
    .set({ isActive: false, curationStatus: "approved" })
    .where(eq(masterCouncils.id, id));
  revalidatePath("/admin/curation/councils");
}
