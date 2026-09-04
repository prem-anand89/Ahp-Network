// THE single file for all user-facing copy, per CLAUDE.md's non-negotiable.
// A counsel review of anything legally load-bearing (badge tooltips,
// consent text, the ToS/Privacy Policy footer gate) becomes a single file
// diff instead of a hunt through every component. Two build-failing tests
// live alongside this file, each enforcing one absolute rule mechanically
// rather than by discipline: a copy-scan test scans every source file's raw
// text for the small set of words a certain class of prohibited language is
// built from (a reviewed-exceptions list covers any legitimate match that
// can't be reworded — empty so far); a footer-legal test asserts the links
// below stay unpopulated and the grievance address stays unpublished until
// their real gates clear.

// ---------------------------------------------------------------------------
// §1A — verification badge tooltip copy. Verbatim. Never paraphrase this
// per-surface; every consumer imports these constants. See
// src/components/badges/ for the locked component module that renders them.
// ---------------------------------------------------------------------------

export const CREDENTIALS_VERIFIED_LABEL = "Credentials Verified";
export const QUALIFICATION_CONFIRMED_LABEL = "Qualification Confirmed";
export const OWNERSHIP_VERIFIED_LABEL = "Ownership Verified";

export function credentialsVerifiedTooltip(dateLabel: string): string {
  return (
    `Credentials Verified — ${dateLabel}. An AHP Network admin has reviewed a document ` +
    `uploaded by this professional and confirmed it appears consistent with the ` +
    `registration details on their profile.\n\n` +
    `This is not a clinical endorsement, not a guarantee of current council registration, ` +
    `not a recommendation, and not an assessment of quality of care. AHP Network does not ` +
    `assess clinical competence.`
  );
}

export function qualificationConfirmedTooltip(dateLabel: string): string {
  return (
    `Qualification Confirmed — ${dateLabel}. An AHP Network admin has reviewed a degree ` +
    `or postgraduate qualification document uploaded by this professional. This confirms ` +
    `the qualification, not current statutory registration to practice, and does not ` +
    `unlock referral claiming or patient information.`
  );
}

export function ownershipVerifiedTooltip(dateLabel: string): string {
  return (
    `Ownership Verified — ${dateLabel}. A business-registration document is on file for ` +
    `this practice.`
  );
}

// ---------------------------------------------------------------------------
// §1B — footer legal links and grievance channel. hrefs stay `null` until
// counsel delivers the actual documents (§15A) — never link to a page that
// doesn't exist yet. copy.footer-legal.test.ts fails the build if any of
// these gets a non-null href or the grievance email gets published while
// its flag is false, so this isn't a discipline to remember, it's enforced.
// ---------------------------------------------------------------------------

export const FOOTER_LEGAL_LINKS = {
  privacyPolicy: { label: "Privacy Policy", href: null as string | null },
  termsOfService: { label: "Terms of Service", href: null as string | null },
  about: { label: "About / operated by TheraNet Technologies", href: null as string | null },
} as const;

// Gated additionally by the grievance_channel_published config flag
// (default false, §8G5) — do not publish this until a named admin is
// actually checking the inbox.
export const GRIEVANCE_OFFICER_EMAIL = "grievance@ahpnetwork.in";

// ---------------------------------------------------------------------------
// §5 / §8D2 — consent text version. Bump on every wording change, including
// placeholder iterations. The actual referral-consent checkbox text is
// Phase 6 scope (still pending counsel per §15A) — this constant exists now
// so copy.ts is the single place that version lives, per CLAUDE.md.
// ---------------------------------------------------------------------------

export const CONSENT_TEXT_VERSION = 1;

// §8D2 — the mandatory, un-prechecked consent checkbox that blocks
// referral creation, and the patient_summary field's guardrail against
// the free-text field quietly defeating the relay-only privacy design.
export const REFERRAL_CONSENT_TEXT =
  "I confirm the patient has agreed to be referred to another allied health professional through AHP Network, and understands their contact details are shared only with the accepting therapist, never the platform.";

export const PATIENT_SUMMARY_PLACEHOLDER = "e.g. 65M, s/p knee replacement, needs regular home PT";

export const PATIENT_SUMMARY_WARNING =
  "Don't include name, phone number, or exact address — just age, condition, and care need.";
