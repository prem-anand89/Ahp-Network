import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/db";
import { practiceClaims, practices, users } from "@/db/schema";
import { approvePracticeClaim, rejectPracticeClaim, raisePracticeClaimQuery } from "./actions";

export default async function PracticeClaimsQueuePage() {
  const db = await getDb();

  const queue = await db
    .select({
      id: practiceClaims.id,
      claimedRelationship: practiceClaims.claimedRelationship,
      registrationNumber: practiceClaims.registrationNumber,
      status: practiceClaims.status,
      practiceName: practices.name,
      practiceClaimStatus: practices.claimStatus,
      claimantEmail: users.email,
      claimantName: users.legalName,
    })
    .from(practiceClaims)
    .innerJoin(practices, eq(practices.id, practiceClaims.practiceId))
    .innerJoin(users, eq(users.id, practiceClaims.claimantUserId))
    .where(inArray(practiceClaims.status, ["submitted", "under_review", "query_raised"]))
    .orderBy(practiceClaims.createdAt);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Practice claims queue</h1>
      <p className="text-sm text-muted-foreground">
        Google Business Profile cannot prove ownership (§8C1) — every claim here needs a real
        registration document reviewed by a human, the same discipline as credential review.
      </p>

      {queue.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing pending.</p>
      ) : (
        <ul className="space-y-4">
          {queue.map((row) => (
            <li key={row.id} className="rounded-md border p-4">
              <p className="font-medium">
                {row.practiceName} — claimed as {row.claimedRelationship} by{" "}
                {row.claimantName ?? row.claimantEmail}
              </p>
              <p className="text-sm text-muted-foreground">
                Registration: {row.registrationNumber ?? "—"}
                {row.practiceClaimStatus === "disputed" && (
                  <span className="ml-2 font-semibold text-destructive">
                    DISPUTED — a second claimant also filed for this practice
                  </span>
                )}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <form action={approvePracticeClaim.bind(null, row.id)}>
                  <button type="submit" className="rounded-md border px-3 py-1 text-sm hover:bg-accent">
                    Approve
                  </button>
                </form>
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    await raisePracticeClaimQuery(row.id, String(formData.get("message") ?? ""));
                  }}
                  className="flex items-center gap-2"
                >
                  <input name="message" placeholder="Query message" className="rounded-md border px-2 py-1 text-sm" />
                  <button type="submit" className="rounded-md border px-3 py-1 text-sm hover:bg-accent">
                    Raise query
                  </button>
                </form>
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    await rejectPracticeClaim(row.id, String(formData.get("reason") ?? ""));
                  }}
                  className="flex items-center gap-2"
                >
                  <input name="reason" placeholder="Rejection reason" className="rounded-md border px-2 py-1 text-sm" />
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
