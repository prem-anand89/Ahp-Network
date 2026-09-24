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
//
// v1 -> v2: added the outcome-reporting clause below. v1 covered only
// contact details flowing outward, once, to the accepting therapist — it
// said nothing about that therapist later reporting the patient's care
// status back, and a referral posted under v1 has no consent basis for
// that report to exist. A referral's consent_text_version is therefore
// checked before it may accept a free-text handover note (see
// referral-outcomes.ts) — enum-only outcomes remain fine under v1, since
// they record only whether the handover worked, not anything about the
// patient. See REFERRAL_LOOP_SPEC_ADDENDUM.md §2 for the full reasoning.
// ---------------------------------------------------------------------------

export const CONSENT_TEXT_VERSION = 2;

// §8D2 — the mandatory, un-prechecked consent checkbox that blocks
// referral creation, and the patient_summary field's guardrail against
// the free-text field quietly defeating the relay-only privacy design.
//
// Two distinct clauses, deliberately not blurred together: the first
// covers contact details moving outward, once, to one named recipient,
// and repeats the existing "never the platform" promise unchanged. The
// second is new in v2 and covers the accepting therapist reporting the
// patient's care status back through AHP Network afterwards — that report
// IS stored on the platform, which is exactly what the first clause
// promises does not happen to contact details, so the two must stay
// separate rather than merged into one vaguer sentence.
export const REFERRAL_CONSENT_TEXT =
  "I confirm the patient has agreed to be referred to another allied health professional through AHP Network, and understands their contact details are shared only with the accepting therapist, never the platform. The patient also understands the accepting therapist may report back a general update on their care (for example, whether treatment is ongoing, completed, or discontinued) through AHP Network, without sharing any further contact details.";

export const PATIENT_SUMMARY_PLACEHOLDER = "e.g. 65M, s/p knee replacement, needs regular home PT";

export const PATIENT_SUMMARY_WARNING =
  "Don't include name, phone number, or exact address — just age, condition, and care need.";

// ---------------------------------------------------------------------------
// REFERRAL_LOOP_SPEC_ADDENDUM.md §4 — the handover note field. Reuses
// patient_summary's exact guardrail pattern (placeholder in the same
// de-identified register + inline warning) rather than inventing a second
// vocabulary. Labelled "Handover note to the referring therapist" wherever
// it's shown — never "clinical notes": the label is what keeps this a
// summary rather than an invitation to write an assessment.
// ---------------------------------------------------------------------------

export const HANDOVER_NOTE_PLACEHOLDER = "e.g. Started home PT, tolerating well so far";

export const HANDOVER_NOTE_WARNING =
  "Don't include name, phone number, or exact address — just a short update on care.";

// ---------------------------------------------------------------------------
// Phase 4 — the case brief. Poster → accepter, the opposite direction
// from the handover note above (accepter → poster) — deliberately named
// differently so the two are never confused in the product's own
// vocabulary despite both being a short write-once note tied to a
// referral. Same guardrail pattern as patient_summary/the handover note:
// a placeholder per field in the same de-identified register, plus one
// shared inline warning above the whole form.
// ---------------------------------------------------------------------------

export const CASE_BRIEF_WARNING =
  "Don't include name, phone number, or exact address — just what the therapist needs to start the case.";

export const CASE_BRIEF_FIELD_PLACEHOLDERS = {
  reasonForReferral: "e.g. Post-op knee rehab, needs progressive strengthening",
  relevantHistory: "e.g. s/p TKR 3 weeks ago, otherwise healthy",
  precautions: "e.g. Weight-bearing as tolerated, avoid high-impact",
  preferredContactWindow: "e.g. Weekday mornings before 11am",
} as const;

// ---------------------------------------------------------------------------
// §10E — the one honest line shown before the credential upload field.
// Verbatim, not paraphrased.
// ---------------------------------------------------------------------------

export const CREDENTIAL_UPLOAD_DISCLOSURE =
  "Your certificate is reviewed by an AHP Network admin to confirm your registration details. It's stored privately and only admins can see it — never shown on your public profile. We keep it for 12 months after your credentials are checked, then it's deleted.";

export const CREDENTIAL_UPLOAD_PHOTO_NOTE =
  "A clear phone photo of a physical certificate is fine — you don't need a scan.";

// ---------------------------------------------------------------------------
// §10D — locality context. Real, specific count if ≥1 active therapist or
// open referral in the locality; this founding-cohort line if zero. Never
// a bare zero, anywhere this shows up.
// ---------------------------------------------------------------------------

export function localityContextLine(count: number, isFoundingCohortFraming: boolean): string {
  if (isFoundingCohortFraming) {
    return "You're one of the first on AHP Network in this area — help build the founding cohort here.";
  }
  return `${count} ${count === 1 ? "person is" : "people are"} already active in this area on AHP Network.`;
}

// ---------------------------------------------------------------------------
// Phase 3 — the directory's "why you're seeing this" line. Plan §1A bans
// comparative-evaluation LANGUAGE, not explaining the sort itself —
// naming the order plainly is the strongest expression of "trust over
// algorithms," not a violation of it. Goes here, not inline in the
// page, so the copy scan covers the exact wording the same way it
// covers everything else.
// ---------------------------------------------------------------------------

export function directoryResultsLine(count: number, roleLabel: string | null, localityLabel: string | null): string {
  const subject = roleLabel ? `${count} ${roleLabel}${count === 1 ? "" : "s"}` : `${count} result${count === 1 ? "" : "s"}`;
  const where = localityLabel ? ` in ${localityLabel}` : "";
  return (
    `Showing ${subject}${where}. Ordered by verification tier, then by how recently they confirmed ` +
    `availability. Not ordered by anything about the quality of their work — AHP Network does not ` +
    `assess clinical competence.`
  );
}

// ---------------------------------------------------------------------------
// §10G — completion checklist. Named and benefit-specific, exact wording,
// never paraphrased.
// ---------------------------------------------------------------------------

export const COMPLETION_CHECKLIST_COPY = {
  skills: "Add 3 skills → show up when someone searches for them",
  photo: "Add a photo → your profile looks complete to visitors",
  availability: "Set your availability → move up in local search",
  credentials: "Upload your certificate → unlock claiming referrals",
  courses: "Add your training → richer profile for anyone who visits",
} as const;

// ---------------------------------------------------------------------------
// §10F — verification celebration, tier-appropriate. [v20] fires for BOTH
// tiers — qualification_confirmed says what was earned, never implies it's
// most of the way to credentials_verified.
// ---------------------------------------------------------------------------

export function verificationCelebrationCopy(tier: "qualification_confirmed" | "credentials_verified"): {
  title: string;
  body: string;
} {
  if (tier === "credentials_verified") {
    return {
      title: "You're Credentials Verified",
      body: "Your registration is confirmed. You can now claim referrals and see patient details for cases you're shortlisted on.",
    };
  }
  return {
    title: "Your qualification is confirmed",
    body: "Your degree is on file and confirmed. Your profile is listed with the Qualification Confirmed badge and you can join communities.",
  };
}

export const INVITE_WHATSAPP_MESSAGE_TEMPLATE =
  "I'm on AHP Network, a verified network for physios, OTs, and speech therapists in Hyderabad. Join here:";

// ---------------------------------------------------------------------------
// Phase 1 step 11 — the public homepage hero. Previously hardcoded directly
// in (public)/page.tsx, against the one-copy.ts rule; moved here in the
// same commit that rebuilds the page around it.
// ---------------------------------------------------------------------------

export const HERO_COPY = {
  eyebrow: "Piloting in Hyderabad",
  headline: "A verified network for allied health professionals.",
  lede:
    "Get your credentials verified, connect with peers, post referrals to your trusted circle, " +
    "and find the specialist your patient needs.",
  primaryCta: "Find a verified therapist",
  secondaryCta: "Join the founding cohort",
} as const;

// Note: this file's own build-failing copy scan bans
// a small closed set of comparative-evaluation words as literal text, with
// zero allowlist, per plan §1A's "anywhere, ever" — enforced even inside
// comments, which is why this note itself avoids spelling any of them out.
// The copy below describes what this product refuses to build without
// using those words; see the test's own header for why a genuine false
// positive gets reworded, not allowlisted.

export const TRUST_STRIP_COPY = [
  "A document, reviewed by a person",
  "No popularity leaderboard, no paid placement",
  "Built for therapists, by the people they refer to",
] as const;

export const HOW_VERIFICATION_WORKS_STEPS = [
  {
    title: "Upload a credential",
    body: "A council registration or a degree — the document, not a claim typed into a form.",
  },
  {
    title: "An admin reviews it",
    body: "A person checks the document against the profile, before anything goes live. Never auto-approved, no matter how confident an automated check is.",
  },
  {
    title: "The badge says what was checked",
    body: "Credentials Verified and Qualification Confirmed are different claims, and the tooltip on each says exactly what was and wasn't confirmed.",
  },
] as const;

export const WHAT_YOU_WONT_FIND_HERE = [
  "A popularity leaderboard or a numeric grade",
  "Paid placement or promoted listings",
  "Patient reviews of a therapist's care",
] as const;

export const DIRECTORY_TEASER_COPY = {
  eyebrow: "The directory",
  headline: "Every listed profile is reviewed before it's public.",
  body: "Browse by role, specialty, and locality — ordered by verification tier and how recently availability was confirmed, never by popularity.",
  cta: "Browse the directory",
} as const;

export const FOUNDING_COHORT_CTA_COPY = {
  headline: "Help shape the first cohort.",
  body: "AHP Network is early. The therapists who join now help decide what the verified network actually needs.",
  cta: "Join the founding cohort",
} as const;


export const CAPACITY_STATE_LABELS = {
  available: "Available for new patients",
  limited: "Limited availability",
  not_taking: "Not taking new patients",
} as const;

// §8A2 — credential upload form (src/app/app/verification/credential-upload-form.tsx).
export const CREDENTIAL_UPLOAD_COPY = {
  chooseFileError: "Choose a file to upload.",
  chooseCouncilError: "Choose a council.",
  invalidFileError: "That file can't be uploaded.",
  uploadFailedError: "Upload failed — please try again.",
  genericError: "Please try again.",
  uploadingLabel: "Uploading…",
  submitLabel: "Submit",
  uploadProgressLabel: (percent: number) => `Uploading — ${percent}%`,
  doneLabel: "Uploaded — an admin will review it soon.",
} as const;

// Round 2 — /app/settings/notifications. Only covers the two
// CONFIGURABLE_EVENT_TYPES (src/lib/notification-preferences.ts) —
// urgent referral_offered is never shown here, it isn't a real choice
// (see that file's own comment on [H1]).
export const NOTIFICATION_SETTING_LABELS = {
  pageTitle: "Notifications",
  pageIntro: "Choose how you'd like to hear about these.",
  alwaysOnNote:
    "A referral offered to you, or referred to you directly by a colleague, always sends by both push and email — those can't be turned off.",
  eventType: {
    referral_posted_match: "A referral matching your profile is posted",
    weekly_digest: "Weekly summary of network activity",
  },
  channel: {
    push: "Push notification",
    email: "Email",
  },
} as const;

// Round 2 — credential document_kind (src/db/schema.ts). Public labels
// shown on /pt/[slug]/verification; the admin label set below is the
// same wording, kept separate so admin-only phrasing (e.g. adding a
// caveat) never has to touch the public-facing set by accident.
export const DOCUMENT_KIND_LABELS = {
  degree_certificate: "Degree certificate",
  provisional_certificate: "Provisional certificate",
  course_completion: "Course completion certificate",
  bonafide: "Bonafide certificate",
} as const;

// §8A2 — the admin verification queue's document-kind selector, shown
// only for degree/postgraduate_degree rows (council_registration has no
// equivalent ambiguity). The bonafide caveat exists because a bonafide
// certificate in India usually certifies current enrollment, not
// completion — accepting one as proof of qualification only makes sense
// if it explicitly states the course was completed.
export const ADMIN_DOCUMENT_KIND_GUIDANCE =
  "What kind of document is this? Only accept \"Bonafide certificate\" if it states the course " +
  "was completed — a bonafide that only confirms current enrollment doesn't satisfy this.";

// §8A2 (Phase 3 backend, Phase 8 UI) — the therapist-facing credential
// upload form. Framed correctly from the start: registration PLUS one
// qualification document, never registration alone — recompute_
// verification_stage() still requires both (Round 2 decision: keep the
// two-factor requirement, broaden what satisfies the qualification side).
export const CREDENTIAL_UPLOAD_GUIDANCE = {
  fastTrackBanner:
    "Upload your council registration, plus any one of: your degree certificate, a bonafide " +
    "certificate (stating course completion), or a course-completion certificate. You don't " +
    "need to upload more than one qualification document.",
  privacyNote:
    "You can cover your photo and date of birth if you'd rather not share them — your name, " +
    "institution, course, and year need to stay visible so it can be checked against your claim.",
} as const;

// Round 2 step 3 — practice 2-way consent (src/lib/practice-consent.ts).
// Either side can initiate; the other accepts or declines. Only an
// 'active' affiliation is ever a real membership — see that file's own
// header for why this can't be treated as a lesser concern than the
// referral engine's state machine.
export const PRACTICE_CONSENT_COPY = {
  alreadyMemberError: "This person is already affiliated with this practice.",
  alreadyPendingError: "There's already a pending invite or request for this person.",
  inviteSentLabel: "Invite sent — they'll see it next time they open the app.",
  inviteNotFoundError: "No email on file matches that address.",
  requestSentLabel: "Request sent — the practice's owner or manager will review it.",
  respondNotFoundError: "That invite or request is no longer pending.",
  selfAssertedRemovalError:
    "This affiliation was asserted by the therapist themselves — it can only be disputed, not removed directly.",
  ownerRemovalError: "An owner can't be removed by another team member.",
  invited: {
    title: "You've been invited",
    body: (practiceName: string) => `${practiceName} invited you to join their team on AHP Network.`,
    accept: "Accept",
    decline: "Decline",
  },
  requested: {
    title: "Pending your response",
    body: (therapistName: string) => `${therapistName} asked to join your practice on AHP Network.`,
    accept: "Approve",
    decline: "Decline",
  },
} as const;


// Round 2 step 4 — the offer window (drizzle/0045: offer_deadline,
// extend_offer). Supersedes §G4's 30min/1h hold. [G4] still applies: the
// poster reads these rules BEFORE the tap. [G1] still applies: the poster
// sees a plain "open until" time, never a countdown — the receiving
// therapist's ring is the only live clock.
export const OFFER_WINDOW_COPY = {
  rulesBeforeTap: (urgency: "routine" | "urgent") =>
    urgency === "urgent"
      ? "Whoever accepts first gets the case. The offer stays open for 2 hours — you can extend it once, by 1 hour."
      : "Whoever accepts first gets the case. The offer stays open for 12 hours, and the clock pauses overnight (10 PM–7 AM) so nobody misses it asleep. You can extend it once.",
  overnightPauseNote: "Paused overnight, 10 PM–7 AM.",
  openUntil: (when: string) => `Open until ${when}.`,
  offeredTo: (names: string[]) => `Offered to ${names.join(" and ")}.`,
  extendButton: (urgency: "routine" | "urgent") =>
    urgency === "urgent" ? "Give them 1 more hour" : "Give them 6 more waking hours",
  extendedNote: "You've extended this offer — it can't be extended again.",
  addAnotherHeading: "Offer to one more therapist",
  missedCandidateNote: "Missed your last offer — you can offer it to them again.",
} as const;

// Round 2 — the First Look disclosure line, shown to everyone who later
// sees the referral. Never names the target: it says a choice was made,
// not who was chosen.
export function firstLookDisclosure(target: { circle: boolean; community: boolean; therapist: boolean }): string {
  if (target.circle) return "Offered to the poster's circle first.";
  if (target.community) return "Offered to one of the poster's communities first.";
  if (target.therapist) return "Offered to one therapist first.";
  return "Offered to someone first.";
}

// Review item #1 — a city-wide (no locality) referral, clinic visits
// only: the patient is willing to travel anywhere in the pilot city.
// Hyderabad-only for the pilot, same as everywhere else in the app.
export const CITY_WIDE_LOCALITY_LABEL = "Hyderabad — patient can travel";
export const CITY_WIDE_TOGGLE_LABEL = "Patient can travel anywhere in Hyderabad — skip choosing a locality";
export const CITY_WIDE_HOME_VISIT_ERROR =
  "A city-wide referral (no locality) is only available for a clinic visit, not a home visit.";

// Step 5 [decision 11] — the "my area isn't listed" Google Places
// fallback, bounded to Hyderabad metro. The new area is usable
// immediately by the person who added it (so their own form doesn't
// stall on a human), but excluded from matching/directory for everyone
// else until an admin approves it — the disclosure line says so plainly.
export const AREA_NOT_LISTED_PROMPT = "Can't find your area?";
export const AREA_SEARCH_PLACEHOLDER = "Search for your locality";
export function areaPendingReviewNote(name: string): string {
  return `Using "${name}" — pending a quick admin review before it's visible to others. You can post/save now.`;
}
export const AREA_OUTSIDE_HYDERABAD_ERROR =
  "That place is outside Hyderabad. AHP Network is Hyderabad-only for now — we'll let you know when your city is available.";
