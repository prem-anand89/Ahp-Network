// Renders INTERIM_PRIVACY_NOTICE.md — see founding-declaration/page.tsx's
// header comment for why this page exists and why it's noindex.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Interim Data & Privacy Notice",
  robots: { index: false, follow: false },
};

export default function PrivacyNoticePage() {
  return (
    <article className="mx-auto max-w-2xl px-6 py-12 text-sm leading-7 text-foreground">
      <h1 className="mb-2 text-2xl font-semibold">Interim Data &amp; Privacy Notice</h1>
      <p className="mb-6 text-muted-foreground">
        <strong>This is not a legal document.</strong> It&apos;s a plain-language explanation of
        what data AHP Network collects, why, and what happens to it — written by the founder, for
        the founding-cohort pilot, until a proper Privacy Policy exists (see the note at the
        bottom for why that hasn&apos;t happened yet). Read this alongside the{" "}
        <Link href="/legal/founding-declaration" className="underline">
          Founding Member Declaration
        </Link>
        .
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">What we collect</h2>
      <ul className="mb-4 list-disc space-y-2 pl-5">
        <li>
          <strong>Your profile:</strong> name, role (physiotherapist / occupational therapist /
          speech-language pathologist), specializations, practice/workplace details, and the
          public contact detail you choose to show.
        </li>
        <li>
          <strong>Your credential documents:</strong> council registration certificates,
          degree/qualification documents, and similar, uploaded by you so an admin can verify
          them. These are processed once through Google Cloud Vision (an OCR service) purely to
          help our admin team review them faster — OCR results never auto-approve anything; a
          human always makes the verification decision.
        </li>
        <li>
          <strong>Referral activity:</strong> referrals you post or accept, and — only after a
          referral is accepted, and only with the patient&apos;s consent recorded at that point —
          the patient contact detail you provide, so the accepting therapist can reach them.
        </li>
        <li>
          <strong>Basic usage data:</strong> the kind of thing any web app logs (page requests,
          errors) to keep the platform working and find bugs.
        </li>
      </ul>
      <p className="mb-4">
        We do <strong>not</strong> collect structured clinical data about patients. The &quot;patient
        summary&quot; field on a referral is a short free-text note (e.g. condition and care
        need) — you&apos;re told explicitly not to put a patient&apos;s name, phone number, or
        address in it.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">How referrals and patient contact details work</h2>
      <p className="mb-4">
        AHP Network currently runs <strong>relay-only contact mode</strong>: when a referral is
        accepted, the patient&apos;s contact detail is shared with the accepting therapist so they
        can reach out directly. AHP Network doesn&apos;t route the call, doesn&apos;t sit in the
        conversation, and doesn&apos;t keep a copy of that contact detail anywhere it can be
        casually read — it&apos;s stored encrypted, and access to it is logged.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">What we don&apos;t do</h2>
      <ul className="mb-4 list-disc space-y-2 pl-5">
        <li>
          <strong>No comparative ordering or point system of any kind, anywhere, on anyone.</strong>{" "}
          Your profile shows verification status (what a badge means is explained on the badge
          itself), never a numeric measure or comparison against other professionals.
        </li>
        <li>
          We don&apos;t sell your data, and we don&apos;t share it with anyone outside the
          specific, narrow purposes above (verifying you, running a referral you chose to take
          part in).
        </li>
        <li>We don&apos;t use your data to train third-party AI models.</li>
      </ul>

      <h2 className="mb-2 mt-6 text-lg font-semibold">Where your data lives</h2>
      <p className="mb-4">
        Profile and referral data is stored in a Postgres database (Supabase, hosted in Mumbai).
        Credential documents are stored in Cloudflare&apos;s object storage (R2). Both are
        access-controlled; admin access to sensitive data (like a referral&apos;s patient contact
        detail) is logged, not just the ability to change it.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">Your rights</h2>
      <p className="mb-4">
        Even before formal DPDP (India&apos;s Digital Personal Data Protection Act) compliance
        processes are fully built out, you can:
      </p>
      <ul className="mb-4 list-disc space-y-2 pl-5">
        <li>Ask what data we hold on you.</li>
        <li>Ask us to correct it.</li>
        <li>
          Ask us to delete your account. Some data (like audit logs of past admin actions, or
          referral records another professional&apos;s care depended on) is retained or
          anonymised rather than hard-deleted, depending on what it is — we&apos;ll tell you
          specifically what happens to your data if you ask.
        </li>
      </ul>
      <p className="mb-4">
        To do any of this, contact the founder directly — see below. There isn&apos;t yet a
        dedicated, published grievance-officer inbox separate from this; that gets set up and
        published once someone is actually assigned to check it regularly, per DPDP&apos;s
        expectation that a grievance channel actually gets a response, not just exist.
        <br />
        Email: <code>theranetconnect@gmail.com</code>
        <br />
        Phone: <code>9032323890</code>
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">
        Why this document exists instead of a real Privacy Policy
      </h2>
      <p className="mb-4">
        TheraNet Technologies is deliberately staying unregistered, and formal legal counsel is
        deliberately not yet engaged, for as long as this stays a small, unmonetized Hyderabad
        pilot — a founder decision, not an oversight. This notice is the honest, temporary bridge
        for that period, describing current practice accurately rather than promising more than is
        actually built. It will be replaced in full, not patched, once the real Privacy Policy
        exists.
      </p>

      <hr className="my-8 border-border" />
      <p className="text-xs text-muted-foreground">
        Version 1 — dated 01/10/2026. Effective for founding-cohort members from that date.
        Superseded in full when TheraNet Technologies&apos; formal Privacy Policy is published.
      </p>
    </article>
  );
}
