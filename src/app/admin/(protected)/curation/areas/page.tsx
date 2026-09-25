import { eq } from "drizzle-orm";
import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { areas } from "@/db/schema";
import { approveArea, rejectArea } from "../actions";

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

      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing pending.</p>
      ) : (
        <ul className="space-y-4">
          {pending.map((row) => (
            <li key={row.id} className="rounded-md border p-4">
              <p className="font-medium">{row.name}</p>
              <p className="text-sm text-muted-foreground">Slug: {row.slug}</p>
              <div className="mt-3 flex gap-2">
                <form action={approveArea.bind(null, row.id)}>
                  <button type="submit" className="rounded-md border px-3 py-1 text-sm hover:bg-accent">
                    Approve
                  </button>
                </form>
                <form action={rejectArea.bind(null, row.id)}>
                  <button
                    type="submit"
                    className="rounded-md border border-destructive px-3 py-1 text-sm text-destructive hover:bg-destructive/10"
                  >
                    Reject
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
