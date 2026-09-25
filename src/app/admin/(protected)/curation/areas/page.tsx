import { eq } from "drizzle-orm";
import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { areas } from "@/db/schema";
import { approveArea, rejectArea, bulkApproveAreas, bulkRejectAreas } from "../actions";
import { BulkCurationQueue } from "@/components/admin/bulk-curation-queue";

export default async function AreaCurationQueuePage() {
  const { db } = await requireAdminAccessOrRedirect({ type: "manage_curation_queue" });

  const pending = await db
    .select()
    .from(areas)
    .where(eq(areas.curationStatus, "pending_review"));

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Area curation queue</h1>
      <p className="text-sm text-muted-foreground">
        Proposed by a therapist who typed a locality name not in the registry, filed under a city
        and zone they picked (Round 3 decision D3) — usable by them immediately, pending review
        here. Approve to make it a real matching/directory locality; reject to remove it from the
        picker.
      </p>

      <BulkCurationQueue
        rows={pending.map((row) => ({
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          lines: [row.name, `Slug: ${row.slug}`],
        }))}
        approveOne={approveArea}
        rejectOne={rejectArea}
        approveMany={bulkApproveAreas}
        rejectMany={bulkRejectAreas}
      />
    </main>
  );
}
