import { describe, expect, it } from "vitest";
import { can, type AuthzUser } from "./authz";

function therapist(overrides: Partial<AuthzUser> = {}): AuthzUser {
  return {
    id: "user-1",
    accountType: "therapist",
    verificationStage: "unverified",
    adminRoles: [],
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
});
