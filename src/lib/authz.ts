import { isWithinContactDisclosureHold } from "./sensitive-identity-change";

// THE single server-side authz module (CLAUDE.md non-negotiable, plan
// §8A3/§8G5). Every route handler and server action funnels through
// can(user, action, resource) — no patient_summary read path, no admin
// action, bypasses it. Built now, before Phase 1 has much to gate, per
// BUILD_SEQUENCE.md's explicit instruction: build it before there's
// anything to gate, or the checks end up scattered.
//
// Postgres RLS is deliberately NOT used — the app connects as a privileged
// role (ahp_app) over Hyperdrive, so a partial RLS policy would read as
// protection that isn't there. This module is the actual enforcement layer.
//
// Actions here are the ones Phase 1 introduces (own-profile edit, admin
// context entry, admin role management) plus the access-tier shape §8A3
// defines for referral claiming and patient_summary — gated now even
// though the referral board itself doesn't exist until Phase 6, so the
// check has a home from day one rather than being invented ad hoc when the
// referral routes finally land.

export type VerificationStage = "unverified" | "qualification_confirmed" | "credentials_verified";
export type AccountType = "therapist" | "practice_manager" | "staff";

export interface AuthzUser {
  id: string;
  accountType: AccountType;
  verificationStage: VerificationStage;
  /** Active (non-revoked) admin_user_roles rows, empty if not an admin. */
  adminRoles: string[];
  /** §4's sensitive-identity-change hold — null or already-expired means no hold is active. */
  contactDisclosureHoldUntil: Date | null;
}

export type Action =
  | { type: "edit_own_profile"; targetUserId: string }
  | { type: "claim_referral" }
  | { type: "view_patient_summary" }
  | { type: "enter_admin_mode" }
  | { type: "manage_admin_roles" }
  | { type: "read_audit_logs" }
  // §8B/§8B2/§8A1a curation queues (courses, institutions, councils) —
  // reuses the same admin habit as the Phase 3 verification queue, so it's
  // scoped to the same role rather than inventing a new one.
  | { type: "manage_curation_queue" }
  // §8C — "any verified therapist can create a practice record." Verified
  // here means either tier, not credentials_verified specifically: §9
  // already treats qualification_confirmed and credentials_verified as
  // both distinct from Unverified, and creating a practice listing is a
  // much lower-stakes action than claiming a referral or reading
  // patient_summary.
  | { type: "create_practice" }
  // §8C1 — claim review is reused from the same admin queue mechanism as
  // credential review; scoped to the same role for the same reason.
  | { type: "manage_practice_claims" }
  // §8E3 — "Platform-curated: admin, freely." Any admin with communities
  // curation standing can post to an owned (platform-curated) community —
  // this used to be super_admin-only when it existed solely for the
  // founding-cohort community's Phase 8 slice; generalized here to match
  // the plan's actual table now that other admins can create and run
  // platform-curated communities too. Institution/certification/workplace/
  // user-created posting eligibility is resource-specific (community
  // membership, a practice access role, or authorship) and checked
  // directly against the DB by the caller, the same way circles.ts checks
  // ownership — not through this role-only function.
  | { type: "post_to_community" }
  // §8E3 — creating a platform-curated community. [H3] no density gate,
  // same tier as curating posts in one.
  | { type: "create_community" }
  // §8E3 — approving/rejecting a moderator application. Same tier as
  // communities curation; deliberately NOT admin_user_roles itself (the
  // resulting grant is scoped to one community, never platform-wide).
  | { type: "manage_community_moderators" }
  // §8E3 — "revocable by super_admin, never re-votable." A strictly
  // narrower bar than approving one, since revocation removes standing
  // from someone who already has it.
  | { type: "revoke_community_moderator" }
  // §8G6's admin nav table, Phase 10 — each maps to a role already
  // defined in §8G5, no new role system invented.
  | { type: "manage_communities_curation" }
  | { type: "manage_referral_ops" }
  | { type: "manage_grievance" }
  | { type: "manage_feedback" }
  // §8H — irreversible, cross-table anonymisation on a real user's
  // explicit request. Not in §8G6's nav table (it predates that section);
  // scoped to super_admin, the same bar as Team & Roles, since this is at
  // least as high-blast-radius and just as rarely exercised.
  | { type: "run_erasure_request" }
  // REFERRAL_LOOP_SPEC_ADDENDUM.md §7 — only the therapist whose
  // referral_interest row is 'accepted' may report, and only once the
  // referral has actually reached handover ('accepted' or later — never
  // 'open'/'shortlisted', where there's no patient to report on yet).
  // Version-gates the handover note here, not in the UI: a referral
  // posted under CONSENT_TEXT_VERSION 1 never agreed to progress being
  // reported back, so a UI-only guard would not be a real consent
  // control.
  | {
      type: "report_referral_outcome";
      interestStatus: string | null;
      referralStatus: string;
      consentTextVersion: string | null;
      hasNote: boolean;
    }
  // §5 — the referring therapist's one canned nudge; asymmetric by
  // design (no free text, no reply). Rate limiting (once per 14 days)
  // is a DB fact checked in referral-outcomes.ts, not an authz concern.
  | { type: "nudge_referral_outcome"; isPoster: boolean; referralStatus: string }
  // §7 — admin reads of outcome updates are always audited (§8G5), same
  // tier as the rest of referral ops.
  | { type: "read_referral_outcomes_as_admin" };

export interface AuthzResult {
  allowed: boolean;
  reason: string;
}

function allow(reason: string): AuthzResult {
  return { allowed: true, reason };
}

function deny(reason: string): AuthzResult {
  return { allowed: false, reason };
}

function isActiveHold(holdUntil: Date | null): boolean {
  return isWithinContactDisclosureHold(holdUntil);
}

export function can(user: AuthzUser | null, action: Action): AuthzResult {
  if (!user) return deny("no authenticated user");

  switch (action.type) {
    case "edit_own_profile":
      return user.id === action.targetUserId
        ? allow("editing own profile")
        : deny("cannot edit another user's profile");

    // §8A3 — referral claiming and patient_summary require
    // credentials_verified specifically, not qualification_confirmed and
    // not just a phone number on file. §4's 48-hour contact-disclosure
    // hold after a sensitive identity change blocks claiming even for an
    // otherwise-eligible therapist — the account keeps working for
    // everything else during the hold.
    case "claim_referral": {
      if (user.accountType !== "therapist" || user.verificationStage !== "credentials_verified") {
        return deny("referral claiming requires credentials_verified");
      }
      if (isActiveHold(user.contactDisclosureHoldUntil)) {
        return deny("blocked by the 48-hour contact-disclosure hold after a recent identity change");
      }
      return allow("credentials_verified therapist");
    }

    case "view_patient_summary":
      if (user.verificationStage !== "credentials_verified") {
        return deny("patient_summary requires credentials_verified, not qualification_confirmed");
      }
      if (isActiveHold(user.contactDisclosureHoldUntil)) {
        return deny("blocked by the 48-hour contact-disclosure hold after a recent identity change");
      }
      return allow("credentials_verified");

    // §8G5 — any active admin role can enter admin mode; role-specific
    // gating (e.g. verification_admin vs. grievance_officer) happens per
    // admin surface once those surfaces exist, not here.
    case "enter_admin_mode":
      return user.adminRoles.length > 0
        ? allow("has an active admin role")
        : deny("no active admin role");

    case "manage_admin_roles":
      return user.adminRoles.includes("super_admin")
        ? allow("super_admin")
        : deny("managing admin roles requires super_admin");

    case "read_audit_logs":
      return user.adminRoles.length > 0
        ? allow("has an active admin role")
        : deny("audit log reads are admin-only");

    case "manage_curation_queue":
      return user.adminRoles.includes("super_admin") ||
        user.adminRoles.includes("verification_admin")
        ? allow("verification_admin or super_admin")
        : deny("curation queue actions require verification_admin or super_admin");

    case "create_practice":
      return user.accountType === "therapist" && user.verificationStage !== "unverified"
        ? allow("verified therapist (either tier)")
        : deny("creating a practice requires at least qualification_confirmed");

    case "manage_practice_claims":
      return user.adminRoles.includes("super_admin") ||
        user.adminRoles.includes("verification_admin")
        ? allow("verification_admin or super_admin")
        : deny("practice claim review requires verification_admin or super_admin");

    case "post_to_community":
      return user.adminRoles.includes("super_admin") || user.adminRoles.includes("verification_admin")
        ? allow("verification_admin or super_admin")
        : deny("posting to a platform-curated community requires verification_admin or super_admin");

    case "create_community":
      return user.adminRoles.includes("super_admin") || user.adminRoles.includes("verification_admin")
        ? allow("verification_admin or super_admin")
        : deny("creating a community requires verification_admin or super_admin");

    case "manage_community_moderators":
      return user.adminRoles.includes("super_admin") || user.adminRoles.includes("verification_admin")
        ? allow("verification_admin or super_admin")
        : deny("approving community moderators requires verification_admin or super_admin");

    case "revoke_community_moderator":
      return user.adminRoles.includes("super_admin")
        ? allow("super_admin")
        : deny("revoking a community moderator requires super_admin");

    // §8G6 admin nav: Communities → verification_admin (community
    // moderators are a separate, narrower mechanism outside
    // admin_user_roles entirely — §8E3 — and aren't checked here).
    case "manage_communities_curation":
      return user.adminRoles.includes("super_admin") ||
        user.adminRoles.includes("verification_admin")
        ? allow("verification_admin or super_admin")
        : deny("communities curation requires verification_admin or super_admin");

    case "manage_referral_ops":
      return user.adminRoles.includes("super_admin") ||
        user.adminRoles.includes("referral_ops_admin")
        ? allow("referral_ops_admin or super_admin")
        : deny("referral ops requires referral_ops_admin or super_admin");

    case "manage_grievance":
      return user.adminRoles.includes("super_admin") ||
        user.adminRoles.includes("grievance_officer")
        ? allow("grievance_officer or super_admin")
        : deny("grievance handling requires grievance_officer or super_admin");

    case "manage_feedback":
      return user.adminRoles.includes("super_admin") ||
        user.adminRoles.includes("support_admin")
        ? allow("support_admin or super_admin")
        : deny("feedback triage requires support_admin or super_admin");

    case "run_erasure_request":
      return user.adminRoles.includes("super_admin")
        ? allow("super_admin")
        : deny("erasure requests require super_admin");

    case "report_referral_outcome": {
      if (action.interestStatus !== "accepted") {
        return deny("only the therapist holding the accepted interest can report an outcome");
      }
      if (!["accepted", "completed", "auto_closed"].includes(action.referralStatus)) {
        return deny("the referral hasn't reached handover yet");
      }
      if (action.hasNote && action.consentTextVersion !== "2") {
        return deny("a handover note requires a referral posted under consent text version 2");
      }
      return allow("accepted interest holder reporting after handover");
    }

    case "nudge_referral_outcome":
      if (!action.isPoster) return deny("only the referral's poster can send the nudge");
      if (!["accepted", "completed", "auto_closed"].includes(action.referralStatus)) {
        return deny("the referral hasn't reached handover yet");
      }
      return allow("poster nudging after handover");

    case "read_referral_outcomes_as_admin":
      return user.adminRoles.includes("super_admin") || user.adminRoles.includes("referral_ops_admin")
        ? allow("referral_ops_admin or super_admin")
        : deny("reading referral outcomes as admin requires referral_ops_admin or super_admin");

    default: {
      const exhaustiveCheck: never = action;
      return deny(`unknown action: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
