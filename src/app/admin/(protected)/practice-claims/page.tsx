import { eq, inArray } from "drizzle-orm";
import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { practiceClaims, practices, users } from "@/db/schema";
import { approvePracticeClaim, rejectPracticeClaim, raisePracticeClaimQuery } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function PracticeClaimsQueuePage() {
  const { db } = await requireAdminAccessOrRedirect({ type: "manage_practice_claims" });

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
                  <Button type="submit" variant="outline" size="sm">
                    Approve
                  </Button>
                </form>
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    await raisePracticeClaimQuery(row.id, String(formData.get("message") ?? ""));
                  }}
                  className="flex items-center gap-2"
                >
                  <Label htmlFor={`message-${row.id}`} className="sr-only">Query message</Label>
                  <Input id={`message-${row.id}`} name="message" placeholder="Query message" className="w-auto" />
                  <Button type="submit" variant="outline" size="sm">
                    Raise query
                  </Button>
                </form>
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    await rejectPracticeClaim(row.id, String(formData.get("reason") ?? ""));
                  }}
                  className="flex items-center gap-2"
                >
                  <Label htmlFor={`reason-${row.id}`} className="sr-only">Rejection reason</Label>
                  <Input id={`reason-${row.id}`} name="reason" placeholder="Rejection reason" className="w-auto" />
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    className="border-destructive text-destructive hover:bg-destructive/10"
                  >
                    Reject
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
