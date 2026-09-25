import { eq } from "drizzle-orm";
import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { masterCouncils } from "@/db/schema";
import { approveCouncil, rejectCouncil, bulkApproveCouncils, bulkRejectCouncils } from "../actions";
import { BulkCurationQueue } from "@/components/admin/bulk-curation-queue";

export default async function CouncilCurationQueuePage() {
  const { db } = await requireAdminAccessOrRedirect({ type: "manage_curation_queue" });

  const pending = await db
    .select()
    .from(masterCouncils)
    .where(eq(masterCouncils.curationStatus, "pending_review"));

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Council curation queue</h1>
      <p className="text-sm text-muted-foreground">
        Hand-curated, never auto-created regardless of match confidence (§8A1a). Approving a row here is
        a real regulatory judgment about whether this is a legitimate statutory registration or
        professional association body — verify before approving, don&apos;t infer from a
        therapist&apos;s own submission alone.
      </p>

      <BulkCurationQueue
        rows={pending.map((row) => ({
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          lines: [row.name, `Type: ${row.councilType} · State: ${row.state ?? "National"}`],
        }))}
        approveOne={approveCouncil}
        rejectOne={rejectCouncil}
        approveMany={bulkApproveCouncils}
        rejectMany={bulkRejectCouncils}
      />
    </main>
  );
}
