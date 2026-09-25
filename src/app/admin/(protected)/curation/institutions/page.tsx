import { eq } from "drizzle-orm";
import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { masterInstitutions } from "@/db/schema";
import { approveInstitution, rejectInstitution, bulkApproveInstitutions, bulkRejectInstitutions } from "../actions";
import { BulkCurationQueue } from "@/components/admin/bulk-curation-queue";

export default async function InstitutionCurationQueuePage() {
  const { db } = await requireAdminAccessOrRedirect({ type: "manage_curation_queue" });

  const pending = await db
    .select()
    .from(masterInstitutions)
    .where(eq(masterInstitutions.curationStatus, "pending_review"));

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Institution curation queue</h1>
      <p className="text-sm text-muted-foreground">
        Built organically from credential submissions (§8B2) — never auto-created from an
        unreviewed fuzzy match. Approve to make it a real, searchable institution; reject to
        remove it.
      </p>

      <BulkCurationQueue
        rows={pending.map((row) => ({
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          lines: [row.name, `City: ${row.city ?? "—"}`],
        }))}
        approveOne={approveInstitution}
        rejectOne={rejectInstitution}
        approveMany={bulkApproveInstitutions}
        rejectMany={bulkRejectInstitutions}
      />
    </main>
  );
}
