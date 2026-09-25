import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { credentials, users } from "@/db/schema";
import { approveCredential, rejectCredential, raiseCredentialQuery } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocumentViewer } from "@/components/admin/document-viewer";
import { ADMIN_DOCUMENT_KIND_GUIDANCE, DOCUMENT_KIND_LABELS } from "@/lib/copy";

// §8A2 — the main queue, prioritised by confidence. query_raised items leave
// this list for a separate "Awaiting therapist" section so they don't
// inflate the queue-depth number that drives the SLA (§8A: "queue-depth
// alert at 15" — the count below is that number).

// Round 2 — only rendered for degree/postgraduate_degree rows (see call
// sites). A plain native <select>, not the shadcn Select: this page's
// forms submit via a native FormData read inside a "use server" closure,
// and a native control needs no client-side state to participate in that.
function DocumentKindSelect({ rowId }: { rowId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`kind-${rowId}`} className="text-xs text-muted-foreground">
        {ADMIN_DOCUMENT_KIND_GUIDANCE}
      </Label>
      <select
        id={`kind-${rowId}`}
        name="documentKind"
        required
        defaultValue=""
        className="h-9 w-fit rounded-md border bg-background px-2 text-sm"
      >
        <option value="" disabled>
          Choose document kind…
        </option>
        {Object.entries(DOCUMENT_KIND_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

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
      hasBackDocument: sql<boolean>`${credentials.documentBackUrl} IS NOT NULL`,
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
                <DocumentViewer credentialId={row.id} hasBackDocument={row.hasBackDocument} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {/* Phase 4 — "did you actually look?" as a mechanism, not
                    a question. Approve fails server-side unless this
                    matches credentials.registration_number exactly
                    (actions.ts). Credentials with no registration number
                    on file (most degrees) skip straight to a plain
                    approve — there's nothing to re-type.

                    Round 2 — the documentKind select lives inside each
                    approve form (duplicated per branch, not shared via a
                    cross-form `form=` attribute) so submission stays a
                    plain, unsurprising single-form FormData read; only
                    degree/postgraduate_degree rows render it, matching
                    credentials_document_kind_type_check. */}
                {row.registrationNumber ? (
                  <form
                    action={async (formData: FormData) => {
                      "use server";
                      await approveCredential(
                        row.id,
                        String(formData.get("confirmRegistrationNumber") ?? ""),
                        String(formData.get("documentKind") ?? ""),
                      );
                    }}
                    className="flex flex-wrap items-center gap-2"
                  >
                    {(row.type === "degree" || row.type === "postgraduate_degree") && (
                      <DocumentKindSelect rowId={row.id} />
                    )}
                    <Label htmlFor={`confirm-reg-${row.id}`} className="sr-only">
                      Re-type the registration number to confirm
                    </Label>
                    <Input
                      id={`confirm-reg-${row.id}`}
                      name="confirmRegistrationNumber"
                      placeholder="Re-type registration number"
                      required
                      className="w-auto"
                    />
                    <Button type="submit" variant="outline" size="sm">
                      Approve
                    </Button>
                  </form>
                ) : (
                  <form
                    action={async (formData: FormData) => {
                      "use server";
                      await approveCredential(row.id, undefined, String(formData.get("documentKind") ?? ""));
                    }}
                    className="flex flex-wrap items-center gap-2"
                  >
                    {(row.type === "degree" || row.type === "postgraduate_degree") && (
                      <DocumentKindSelect rowId={row.id} />
                    )}
                    <Button type="submit" variant="outline" size="sm">
                      Approve
                    </Button>
                  </form>
                )}
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
