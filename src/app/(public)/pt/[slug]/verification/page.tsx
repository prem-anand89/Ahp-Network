// Phase 3 — the Public Verification Record. "Today rendered as a
// 90×24px chip. This is the product thesis." A permanent, linkable,
// indexable URL per verified profile — not a modal, not a tooltip —
// naming exactly what was checked and what wasn't, in the badge's own
// verbatim §1A wording (never paraphrased here either).

import { and, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getDb } from "@/db/db";
import { users } from "@/db/schema";
import { getPublicVerificationRecord } from "@/lib/verification-record";
import { RegNumber } from "@/components/ui-ahp/reg-number";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { SITE_METADATA } from "@/lib/site-metadata";
import { credentialsVerifiedTooltip, qualificationConfirmedTooltip, DOCUMENT_KIND_LABELS } from "@/lib/copy";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  degree: "Degree",
  postgraduate_degree: "Postgraduate degree",
  council_registration: "Council registration",
};

async function getData(slug: string) {
  const db = await getDb();
  const [profile] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.slug, slug),
        eq(users.accountType, "therapist"),
        eq(users.profileStatus, "active"),
        eq(users.profileVisibility, "public"),
        isNull(users.deletedAt),
      ),
    );
  if (!profile || profile.verificationStage === "unverified") return null;

  const record = await getPublicVerificationRecord(db, profile.id);
  return { profile, record };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getData(slug);
  if (!data) return { title: "Verification record not found" };

  const name = data.profile.displayName ?? "This profile";
  const description = `What AHP Network checked for ${name}, and what it didn't — a permanent, linkable record.`;
  return {
    title: `${name}'s verification record`,
    description,
    openGraph: {
      title: `${name}'s verification record | ${SITE_METADATA.name}`,
      description,
      url: `${SITE_METADATA.url}/pt/${slug}/verification`,
      siteName: SITE_METADATA.name,
      type: "profile",
    },
  };
}

export default async function VerificationRecordPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getData(slug);
  if (!data) notFound();

  const { profile, record } = data;
  // Both tooltip functions produce "<Label> — <date>. <what was
  // checked>\n\n<what wasn't>", verbatim, never paraphrased — the date
  // is shown per-entry below instead, so this page only needs the
  // sentence after the first ". " (the badge label + date lead-in).
  const fullDisclaimer =
    profile.verificationStage === "credentials_verified"
      ? credentialsVerifiedTooltip("")
      : qualificationConfirmedTooltip("");
  const disclaimerBody = fullDisclaimer.slice(fullDisclaimer.indexOf(". ") + 2);

  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-10">
      <Link href={`/pt/${slug}`} className="text-sm text-muted-foreground hover:underline">
        ← Back to {profile.displayName ?? "profile"}&apos;s profile
      </Link>

      <div className="mt-4 flex items-center gap-2 text-verified-text">
        <ShieldCheck className="size-5" aria-hidden />
        <h1 className="text-xl font-semibold">
          {profile.displayName ?? "This profile"}&apos;s verification record
        </h1>
      </div>

      {record.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No credential is currently shown on the public record. This does not mean nothing was
          reviewed — the therapist may have opted a specific document out of public display without
          affecting their badge.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {record.map((entry) => (
            <li key={entry.id} className="rounded-card border bg-card p-4">
              {/* Round 2 — a documentKind label (set by the admin at
                  approval) is honest about what the document actually
                  is; the bare credential-type label ("Degree") would
                  falsely claim that for a bonafide or course-completion
                  certificate. Registration entries have no documentKind
                  (credentials_document_kind_type_check) and keep the
                  type label. */}
              <p className="text-sm font-semibold text-card-foreground">
                {(entry.documentKind && DOCUMENT_KIND_LABELS[entry.documentKind]) ??
                  TYPE_LABELS[entry.type] ??
                  entry.type}
              </p>
              <dl className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
                {entry.councilName && (
                  <div className="flex gap-1.5">
                    <dt className="font-medium text-card-foreground">Council:</dt>
                    <dd>{entry.councilName}</dd>
                  </div>
                )}
                {entry.institutionName && (
                  <div className="flex gap-1.5">
                    <dt className="font-medium text-card-foreground">Institution:</dt>
                    <dd>{entry.institutionName}</dd>
                  </div>
                )}
                {entry.registrationNumber && (
                  <div className="flex gap-1.5">
                    <dt className="font-medium text-card-foreground">Reg. no.:</dt>
                    <dd>
                      <RegNumber>{entry.registrationNumber}</RegNumber>
                    </dd>
                  </div>
                )}
                {entry.verifiedAt && (
                  <div className="flex gap-1.5">
                    <dt className="font-medium text-card-foreground">Reviewed:</dt>
                    <dd>
                      {new Date(entry.verifiedAt).toLocaleDateString("en-IN", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </dd>
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}

      <Accordion type="single" collapsible className="mt-8">
        <AccordionItem value="what-was-checked">
          <AccordionTrigger className="text-sm font-semibold">
            What was checked, and what wasn&apos;t
          </AccordionTrigger>
          <AccordionContent className="whitespace-pre-line text-sm text-muted-foreground">
            {disclaimerBody}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </main>
  );
}
