import { describe, expect, it } from "vitest";
import { can, type AuthzUser } from "./authz";

function therapist(overrides: Partial<AuthzUser> = {}): AuthzUser {
  return {
    id: "user-1",
    accountType: "therapist",
    verificationStage: "unverified",
    adminRoles: [],
    contactDisclosureHoldUntil: null,
    ...overrides,
  };
}

describe("authz — can(user, action)", () => {
  it("denies every action for no authenticated user", () => {
    expect(can(null, { type: "claim_referral" }).allowed).toBe(false);
    expect(can(null, { type: "enter_admin_mode" }).allowed).toBe(false);
  });

  describe("edit_own_profile", () => {
    it("allows editing your own profile", () => {
      const user = therapist({ id: "user-1" });
      expect(can(user, { type: "edit_own_profile", targetUserId: "user-1" }).allowed).toBe(true);
    });
    it("denies editing someone else's profile", () => {
      const user = therapist({ id: "user-1" });
      expect(can(user, { type: "edit_own_profile", targetUserId: "user-2" }).allowed).toBe(false);
    });
  });

  describe("claim_referral (§8A3 — credentials_verified only)", () => {
    it("denies an unverified therapist", () => {
      expect(can(therapist({ verificationStage: "unverified" }), { type: "claim_referral" }).allowed).toBe(false);
    });
    it("denies a qualification_confirmed therapist — this is the specific gap v18 got wrong", () => {
      expect(
        can(therapist({ verificationStage: "qualification_confirmed" }), { type: "claim_referral" }).allowed,
      ).toBe(false);
    });
    it("allows a credentials_verified therapist", () => {
      expect(
        can(therapist({ verificationStage: "credentials_verified" }), { type: "claim_referral" }).allowed,
      ).toBe(true);
    });
    it("denies a credentials_verified practice_manager — claiming is a therapist action", () => {
      expect(
        can(therapist({ accountType: "practice_manager", verificationStage: "credentials_verified" }), {
          type: "claim_referral",
        }).allowed,
      ).toBe(false);
    });

    it("denies a credentials_verified therapist inside an active §4 contact-disclosure hold", () => {
      const holdUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      const result = can(
        therapist({ verificationStage: "credentials_verified", contactDisclosureHoldUntil: holdUntil }),
        { type: "claim_referral" },
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/contact-disclosure hold/);
    });

    it("allows a credentials_verified therapist once the hold has expired", () => {
      const holdUntil = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const result = can(
        therapist({ verificationStage: "credentials_verified", contactDisclosureHoldUntil: holdUntil }),
        { type: "claim_referral" },
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe("view_patient_summary (§8A3 — gated at credentials_verified specifically)", () => {
    it("denies qualification_confirmed", () => {
      expect(
        can(therapist({ verificationStage: "qualification_confirmed" }), { type: "view_patient_summary" }).allowed,
      ).toBe(false);
    });
    it("allows credentials_verified", () => {
      expect(
        can(therapist({ verificationStage: "credentials_verified" }), { type: "view_patient_summary" }).allowed,
      ).toBe(true);
    });
    it("denies credentials_verified during an active §4 hold too — not just claim_referral", () => {
      const holdUntil = new Date(Date.now() + 60 * 60 * 1000);
      expect(
        can(
          therapist({ verificationStage: "credentials_verified", contactDisclosureHoldUntil: holdUntil }),
          { type: "view_patient_summary" },
        ).allowed,
      ).toBe(false);
    });
  });

  describe("admin actions (§8G5)", () => {
    it("denies enter_admin_mode with no admin roles", () => {
      expect(can(therapist({ adminRoles: [] }), { type: "enter_admin_mode" }).allowed).toBe(false);
    });
    it("allows enter_admin_mode with any active admin role", () => {
      expect(can(therapist({ adminRoles: ["support_admin"] }), { type: "enter_admin_mode" }).allowed).toBe(true);
    });
    it("denies manage_admin_roles for a non-super_admin", () => {
      expect(
        can(therapist({ adminRoles: ["verification_admin"] }), { type: "manage_admin_roles" }).allowed,
      ).toBe(false);
    });
    it("allows manage_admin_roles for super_admin", () => {
      expect(can(therapist({ adminRoles: ["super_admin"] }), { type: "manage_admin_roles" }).allowed).toBe(true);
    });
    it("allows read_audit_logs for any admin role, denies for none", () => {
      expect(can(therapist({ adminRoles: ["grievance_officer"] }), { type: "read_audit_logs" }).allowed).toBe(true);
      expect(can(therapist({ adminRoles: [] }), { type: "read_audit_logs" }).allowed).toBe(false);
    });
  });

  describe("create_practice (§8C)", () => {
    it("denies an unverified therapist", () => {
      expect(
        can(therapist({ verificationStage: "unverified" }), { type: "create_practice" }).allowed,
      ).toBe(false);
    });
    it("allows qualification_confirmed, the lower of the two verified tiers", () => {
      expect(
        can(therapist({ verificationStage: "qualification_confirmed" }), { type: "create_practice" })
          .allowed,
      ).toBe(true);
    });
    it("allows credentials_verified", () => {
      expect(
        can(therapist({ verificationStage: "credentials_verified" }), { type: "create_practice" })
          .allowed,
      ).toBe(true);
    });
    it("denies a non-therapist account type even if verified", () => {
      expect(
        can(therapist({ accountType: "staff", verificationStage: "credentials_verified" }), {
          type: "create_practice",
        }).allowed,
      ).toBe(false);
    });
  });

  describe("manage_practice_claims (§8C1)", () => {
    it("denies a therapist with no admin role", () => {
      expect(can(therapist({ adminRoles: [] }), { type: "manage_practice_claims" }).allowed).toBe(
        false,
      );
    });
    it("denies an unrelated admin role", () => {
      expect(
        can(therapist({ adminRoles: ["grievance_officer"] }), { type: "manage_practice_claims" })
          .allowed,
      ).toBe(false);
    });
    it("allows verification_admin", () => {
      expect(
        can(therapist({ adminRoles: ["verification_admin"] }), { type: "manage_practice_claims" })
          .allowed,
      ).toBe(true);
    });
    it("allows super_admin", () => {
      expect(
        can(therapist({ adminRoles: ["super_admin"] }), { type: "manage_practice_claims" }).allowed,
      ).toBe(true);
    });
  });

  describe("post_to_community (§8E3 — founder-moderated founding-cohort community)", () => {
    it("denies a therapist with no admin role", () => {
      expect(can(therapist({ adminRoles: [] }), { type: "post_to_community" }).allowed).toBe(false);
    });
    it("denies a non-super_admin admin role", () => {
      expect(
        can(therapist({ adminRoles: ["verification_admin"] }), { type: "post_to_community" }).allowed,
      ).toBe(false);
    });
    it("allows super_admin", () => {
      expect(can(therapist({ adminRoles: ["super_admin"] }), { type: "post_to_community" }).allowed).toBe(
        true,
      );
    });
  });
});
