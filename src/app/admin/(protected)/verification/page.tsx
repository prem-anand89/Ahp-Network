import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { credentials, users } from "@/db/schema";
import { approveCredential, rejectCredential, raiseCredentialQuery } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocumentViewer } from "@/components/admin/document-viewer";

// §8A2 — the main queue, prioritised by confidence. query_raised items leave
// this list for a separate "Awaiting therapist" section so they don't
// inflate the queue-depth number that drives the SLA (§8A: "queue-depth
// alert at 15" — the count below is that number).

export default async function VerificationQueuePage() {
  const { db } = await requireAdminAccessOrRedirect({ type: "manage_curation_queue" });

  const queue = await db
    .select({
      id: credentials.id,
      type: credentials.type,
      registrationNumber: credentials.registrationNumber,
      confidenceScore: credentials.confidenceScore,
      status: credentials.status,
      createdAt: credentials.createdAt,
      legalName: users.legalName,
      email: users.email,
    })
    .from(credentials)
    .innerJoin(users, eq(users.id, credentials.userId))
    .where(
      and(inArray(credentials.status, ["pending", "under_review"]), isNull(credentials.deletedAt)),
    )
    .orderBy(desc(credentials.confidenceScore), credentials.createdAt);

  const awaitingTherapist = await db
    .select({
      id: credentials.id,
      type: credentials.type,
      queryMessage: credentials.queryMessage,
      queryRaisedAt: credentials.queryRaisedAt,
      legalName: users.legalName,
    })
    .from(credentials)
    .innerJoin(users, eq(users.id, credentials.userId))
    .where(eq(credentials.status, "query_raised"))
    .orderBy(credentials.queryRaisedAt);

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <div>
        <h1 className="text-xl font-semibold">Verification queue</h1>
        <p className="text-sm text-muted-foreground">
          {queue.length} pending{queue.length >= 15 ? " — over the SLA alert threshold" : ""}
        </p>
      </div>

      {queue.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing pending.</p>
      ) : (
        <ul className="space-y-4">
          {queue.map((row) => (
            <li key={row.id} className="rounded-md border p-4">
              <p className="font-medium">
                {row.legalName ?? row.email} — {row.type}
              </p>
              <p className="text-sm text-muted-foreground">
                Registration: {row.registrationNumber ?? "—"} · Confidence:{" "}
                {row.confidenceScore ?? "not yet checked"}
              </p>
              {/* Compares document against claim instead of trusting the
                  claim — an admin previously had no way to see the
                  uploaded document at all from this queue. */}
              <div className="mt-2">
                <DocumentViewer credentialId={row.id} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <form action={approveCredential.bind(null, row.id)}>
                  <Button type="submit" variant="outline" size="sm">
                    Approve
                  </Button>
                </form>
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    await raiseCredentialQuery(row.id, String(formData.get("message") ?? ""));
                  }}
                  className="flex items-center gap-2"
                >
                  <Label htmlFor={`message-${row.id}`} className="sr-only">Query message</Label>
                  <Input
                    id={`message-${row.id}`}
                    name="message"
                    placeholder="Query message"
                    className="w-auto"
                  />
                  <Button type="submit" variant="outline" size="sm">
                    Raise query
                  </Button>
                </form>
                <form action={rejectCredential.bind(null, row.id)}>
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

      <div>
        <h2 className="text-lg font-semibold">Awaiting therapist</h2>
        <p className="text-sm text-muted-foreground">
          Excluded from the queue-depth count above (plan §8A) — the therapist owns the next step.
        </p>
        {awaitingTherapist.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {awaitingTherapist.map((row) => (
              <li key={row.id} className="rounded-md border p-3 text-sm">
                {row.legalName} — {row.type}: &ldquo;{row.queryMessage}&rdquo;
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
