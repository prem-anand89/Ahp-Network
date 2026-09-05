import { eq } from "drizzle-orm";
import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { masterInstitutions } from "@/db/schema";
import { approveInstitution, rejectInstitution } from "../actions";

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

      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing pending.</p>
      ) : (
        <ul className="space-y-4">
          {pending.map((row) => (
            <li key={row.id} className="rounded-md border p-4">
              <p className="font-medium">{row.name}</p>
              <p className="text-sm text-muted-foreground">City: {row.city ?? "—"}</p>
              <div className="mt-3 flex gap-2">
                <form action={approveInstitution.bind(null, row.id)}>
                  <button
                    type="submit"
                    className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
                  >
                    Approve
                  </button>
                </form>
                <form action={rejectInstitution.bind(null, row.id)}>
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
