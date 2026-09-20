// Phase 4 bug fix regression coverage — the upload form used to gate on
// `mine.length === 0`, so a therapist whose only credential hit
// query_raised had no way to resubmit at all.

import { describe, expect, it } from "vitest";
import { canUploadCredential } from "./credential-upload-gate";

describe("canUploadCredential", () => {
  it("allows upload with no credentials at all", () => {
    expect(canUploadCredential([])).toBe(true);
  });

  it("allows re-upload when the only credential hit query_raised — the real bug", () => {
    expect(canUploadCredential([{ status: "query_raised" }])).toBe(true);
  });

  it("allows re-upload when the only credential was rejected", () => {
    expect(canUploadCredential([{ status: "rejected" }])).toBe(true);
  });

  it("blocks upload while a credential is pending", () => {
    expect(canUploadCredential([{ status: "pending" }])).toBe(false);
  });

  it("blocks upload while a credential is under_review", () => {
    expect(canUploadCredential([{ status: "under_review" }])).toBe(false);
  });

  it("blocks upload once a credential is approved", () => {
    expect(canUploadCredential([{ status: "approved" }])).toBe(false);
  });

  it("an approved credential blocks upload even alongside an earlier rejected one", () => {
    expect(canUploadCredential([{ status: "rejected" }, { status: "approved" }])).toBe(false);
  });
});
