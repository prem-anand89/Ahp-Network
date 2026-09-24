"use server";

// Phase 2 curation queues — plan §8B (courses), §8B2 (institutions),
// §8A1a (councils). Step 5 [decision 11] adds areas. Gated via
// requireAdminAccess (manage_curation_queue).

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdminAccess } from "@/lib/require-admin-access";
import { areas, courseCompletions, masterInstitutions, masterCouncils } from "@/db/schema";

export async function approveCourseCompletion(id: string, masterCourseId: string) {
  const { db } = await requireAdminAccess({ type: "manage_curation_queue" });
  await db
    .update(courseCompletions)
    .set({ masterCourseId, curationStatus: "approved", updatedAt: new Date() })
    .where(eq(courseCompletions.id, id));
  revalidatePath("/admin/curation/courses");
}

export async function rejectCourseCompletion(id: string) {
  const { db } = await requireAdminAccess({ type: "manage_curation_queue" });
  await db
    .update(courseCompletions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(courseCompletions.id, id));
  revalidatePath("/admin/curation/courses");
}

export async function approveInstitution(id: string) {
  const { db } = await requireAdminAccess({ type: "manage_curation_queue" });
  await db
    .update(masterInstitutions)
    .set({ curationStatus: "approved" })
    .where(eq(masterInstitutions.id, id));
  revalidatePath("/admin/curation/institutions");
}

export async function rejectInstitution(id: string) {
  const { db } = await requireAdminAccess({ type: "manage_curation_queue" });
  await db
    .update(masterInstitutions)
    .set({ isActive: false, curationStatus: "approved" })
    .where(eq(masterInstitutions.id, id));
  revalidatePath("/admin/curation/institutions");
}

export async function approveCouncil(id: string) {
  const { db } = await requireAdminAccess({ type: "manage_curation_queue" });
  await db
    .update(masterCouncils)
    .set({ curationStatus: "approved" })
    .where(eq(masterCouncils.id, id));
  revalidatePath("/admin/curation/councils");
}

export async function rejectCouncil(id: string) {
  const { db } = await requireAdminAccess({ type: "manage_curation_queue" });
  await db
    .update(masterCouncils)
    .set({ isActive: false, curationStatus: "approved" })
    .where(eq(masterCouncils.id, id));
  revalidatePath("/admin/curation/councils");
}

export async function approveArea(id: string) {
  const { db } = await requireAdminAccess({ type: "manage_curation_queue" });
  await db.update(areas).set({ curationStatus: "approved" }).where(eq(areas.id, id));
  revalidatePath("/admin/curation/areas");
}

export async function rejectArea(id: string) {
  const { db } = await requireAdminAccess({ type: "manage_curation_queue" });
  // isActive: false (not a delete) — same pattern as institutions/councils.
  // A referral or home-visit-area row can already point at this id; the
  // approved-only read filters (referral-matching.ts, directory.ts,
  // areas.ts) keep it out of matching/directory either way, isActive just
  // additionally hides it from any admin listing that filters on it.
  await db.update(areas).set({ isActive: false, curationStatus: "approved" }).where(eq(areas.id, id));
  revalidatePath("/admin/curation/areas");
}
