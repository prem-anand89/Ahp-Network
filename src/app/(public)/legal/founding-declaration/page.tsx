// Renders FOUNDING_MEMBER_DECLARATION.md for real people to actually read
// before onboarding — CLAUDE.md's one remaining open item ("filling the
// placeholders... blocks onboarding real people") is resolved by the doc
// itself already being filled in; what was missing was a page to link to.
// noindex: this is the interim bridge document, not the real ToS — it
// shouldn't outlive its purpose in a search index.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Founding Member Declaration",
  robots: { index: false, follow: false },
};

export default function FoundingDeclarationPage() {
  return (
    <article className="mx-auto max-w-2xl px-6 py-12 text-sm leading-7 text-foreground">
      <h1 className="mb-2 text-2xl font-semibold">Founding Member Declaration</h1>
      <p className="mb-6 text-muted-foreground">
        <strong>This is not a legal document.</strong> It&apos;s written in plain language, by the
        founder, so you know exactly what you&apos;re joining and what you&apos;re not agreeing to.
        It will be replaced by a proper Terms of Service once TheraNet Technologies is formally
        registered and that document has been through counsel — see the note at the bottom for
        why that hasn&apos;t happened yet.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">What AHP Network is, right now</h2>
      <p className="mb-4">
        AHP Network is a small, invite-only pilot for physiotherapists, occupational therapists,
        and speech-language pathologists in Hyderabad. It&apos;s operated by TheraNet
        Technologies — at the time you&apos;re reading this, not yet a formally registered
        company. You&apos;re one of a small founding cohort, not a customer of an established
        platform.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">What you&apos;re agreeing to by using it</h2>
      <ul className="mb-4 list-disc space-y-2 pl-5">
        <li>
          You&apos;re joining as a <strong>founding member</strong> of a pilot, not a finished
          product. Things will change, sometimes quickly, based on what the cohort needs.
        </li>
        <li>
          The information you provide (your profile, your credentials, referrals you post or
          accept) is used to run the platform as described in the{" "}
          <Link href="/legal/privacy-notice" className="underline">
            Interim Data &amp; Privacy Notice
          </Link>{" "}
          — read that alongside this one.
        </li>
        <li>
          <strong>
            &quot;Credentials Verified&quot; and &quot;Qualification Confirmed&quot; mean exactly
            what their tooltips say on your profile, and nothing more.
          </strong>{" "}
          An admin checked that a document you uploaded looks consistent with what you claimed. It
          is not a clinical endorsement, not a guarantee of your current council registration, not
          a recommendation, and not an assessment of the quality of your care.
        </li>
        <li>
          <strong>AHP Network is not a healthcare provider.</strong> It doesn&apos;t employ or
          supervise you, isn&apos;t a party to any care relationship you enter into through a
          referral, and doesn&apos;t arrange, route, or take responsibility for patient care.
          Referrals made through the platform are between you and the other professional.
        </li>
        <li>
          Because this is a small, early pilot, the platform may have bugs, gaps, or downtime.
          There&apos;s no service-level guarantee at this stage — if something breaks, tell the
          founder directly (see below) and it&apos;ll get fixed as fast as a very small team can
          manage.
        </li>
        <li>
          You can ask to have your account and data removed at any time. See the Interim Data
          &amp; Privacy Notice for what &quot;removed&quot; actually means for each piece of data.
        </li>
      </ul>

      <h2 className="mb-2 mt-6 text-lg font-semibold">Why this document exists instead of a real ToS</h2>
      <p className="mb-4">
        TheraNet Technologies is deliberately staying unregistered, and formal legal counsel is
        deliberately not yet engaged, for as long as this stays a small, unmonetized Hyderabad
        pilot. That&apos;s a founder decision, not an oversight — spending on registration and
        counsel is being held until there&apos;s a real reason to spend it: expanding beyond
        Hyderabad, or turning on monetization. Neither has happened yet.
      </p>
      <p className="mb-4">
        This declaration and its companion privacy notice are the honest, temporary bridge for
        that in-between period. They&apos;ll be replaced in full, not patched, once the real
        documents exist.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">Questions or concerns</h2>
      <p className="mb-4">
        Contact the founder directly:
        <br />
        Email: <code>theranetconnect@gmail.com</code>
        <br />
        Phone: <code>9032323890</code>
      </p>

      <hr className="my-8 border-border" />
      <p className="text-xs text-muted-foreground">
        Version 1 — dated 01/10/2026. Effective for founding-cohort members from that date.
        Superseded in full when TheraNet Technologies&apos; formal Terms of Service is published.
      </p>
    </article>
  );
}
