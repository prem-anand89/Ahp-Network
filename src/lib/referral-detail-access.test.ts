import { describe, expect, it } from "vitest";
import { canViewPatientSummaryOnReferral, canViewReferralDetail } from "./referral-actions";
import type { AuthzUser } from "./authz";

function therapist(overrides: Partial<AuthzUser> = {}): AuthzUser {
  return {
    id: "viewer-1",
    accountType: "therapist",
    verificationStage: "credentials_verified",
    adminRoles: [],
    contactDisclosureHoldUntil: null,
    ...overrides,
  };
}

describe("canViewReferralDetail", () => {
  const referral = { postedByUserId: "poster-1", status: "completed" };

  it("allows the poster on any status", () => {
    expect(canViewReferralDetail(referral, "poster-1", false)).toBe(true);
  });

  it("allows anyone with an interest row", () => {
    expect(canViewReferralDetail(referral, "viewer-1", true)).toBe(true);
  });

  it("allows any therapist on open referrals (network activity feed)", () => {
    expect(canViewReferralDetail({ ...referral, status: "open" }, "viewer-1", false)).toBe(true);
  });

  it("denies unrelated viewers on non-open referrals", () => {
    expect(canViewReferralDetail(referral, "viewer-1", false)).toBe(false);
  });
});

describe("canViewPatientSummaryOnReferral", () => {
  it("always allows the poster", () => {
    expect(
      canViewPatientSummaryOnReferral(
        therapist({ verificationStage: "unverified" }),
        true,
        null,
      ),
    ).toBe(true);
  });

  it("denies matched-pool therapists before shortlist", () => {
    expect(canViewPatientSummaryOnReferral(therapist(), false, "pending")).toBe(false);
  });

  it("allows shortlisted credentials_verified therapists", () => {
    expect(canViewPatientSummaryOnReferral(therapist(), false, "shortlisted")).toBe(true);
  });

  it("denies shortlisted qualification_confirmed therapists", () => {
    expect(
      canViewPatientSummaryOnReferral(
        therapist({ verificationStage: "qualification_confirmed" }),
        false,
        "shortlisted",
      ),
    ).toBe(false);
  });

  it("denies credentials_verified therapists during contact-disclosure hold", () => {
    expect(
      canViewPatientSummaryOnReferral(
        therapist({ contactDisclosureHoldUntil: new Date(Date.now() + 60_000) }),
        false,
        "accepted",
      ),
    ).toBe(false);
  });
});
