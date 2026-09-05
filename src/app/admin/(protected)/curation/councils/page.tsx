import { eq } from "drizzle-orm";
import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { masterCouncils } from "@/db/schema";
import { approveCouncil, rejectCouncil } from "../actions";

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

      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing pending.</p>
      ) : (
        <ul className="space-y-4">
          {pending.map((row) => (
            <li key={row.id} className="rounded-md border p-4">
              <p className="font-medium">{row.name}</p>
              <p className="text-sm text-muted-foreground">
                Type: {row.councilType} · State: {row.state ?? "National"}
              </p>
              <div className="mt-3 flex gap-2">
                <form action={approveCouncil.bind(null, row.id)}>
                  <button
                    type="submit"
                    className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
                  >
                    Approve
                  </button>
                </form>
                <form action={rejectCouncil.bind(null, row.id)}>
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
