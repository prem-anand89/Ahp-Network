"use server";

// Phase 2 curation queues — plan §8B (courses), §8B2 (institutions),
// §8A1a (councils). Gated via requireAdminAccess (manage_curation_queue).

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdminAccess } from "@/lib/require-admin-access";
import { courseCompletions, masterInstitutions, masterCouncils } from "@/db/schema";

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
