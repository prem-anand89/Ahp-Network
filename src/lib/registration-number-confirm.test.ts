// Phase 4 — "did you actually look?" as a mechanism. Regression coverage
// for the re-type-the-registration-number confirmation on admin credential
// approval (deferred from Phase 1).

import { describe, expect, it } from "vitest";
import { registrationNumberMatches } from "./registration-number-confirm";

describe("registrationNumberMatches", () => {
  it("passes when the typed number matches exactly", () => {
    expect(registrationNumberMatches("APPT/2019/04412", "APPT/2019/04412")).toBe(true);
  });

  it("fails on any mismatch, including whitespace-only difference in the wrong place", () => {
    expect(registrationNumberMatches("APPT/2019/04412", "APPT/2019/04413")).toBe(false);
    expect(registrationNumberMatches("APPT/2019/04412", "appt/2019/04412")).toBe(false);
  });

  it("trims surrounding whitespace on the typed value only", () => {
    expect(registrationNumberMatches("APPT/2019/04412", "  APPT/2019/04412  ")).toBe(true);
  });

  it("fails when nothing was typed at all", () => {
    expect(registrationNumberMatches("APPT/2019/04412", undefined)).toBe(false);
    expect(registrationNumberMatches("APPT/2019/04412", "")).toBe(false);
  });

  it("is a no-op when the credential has no registration number on file (most degrees)", () => {
    expect(registrationNumberMatches(null, undefined)).toBe(true);
    expect(registrationNumberMatches(null, "anything")).toBe(true);
  });
});
