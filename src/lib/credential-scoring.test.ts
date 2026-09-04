import { describe, expect, it } from "vitest";
import { scoreCredential } from "./credential-scoring";

describe("scoreCredential (§8A2 — queue priority only, never gates)", () => {
  it("scores a clean match near the top of its range", () => {
    const result = scoreCredential({
      legalName: "Priya Sharma",
      ocrExtractedName: "Priya Sharma",
      ocrExtractedRegistrationNumber: "TG-PT-2024-001234",
      registrationNumberPattern: "^TG-PT-\\d{4}-\\d{6}$",
      expiryDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    });
    expect(result.nameSimilarity).toBe(50);
    expect(result.registrationFormatMatch).toBe(30);
    expect(result.expirySanity).toBe(20);
    expect(result.confidenceScore).toBe(100);
  });

  it("scores a poor name match low without erroring", () => {
    const result = scoreCredential({
      legalName: "Priya Sharma",
      ocrExtractedName: "Completely Different Person",
      ocrExtractedRegistrationNumber: null,
      registrationNumberPattern: null,
      expiryDate: null,
    });
    expect(result.nameSimilarity).toBeLessThan(20);
    expect(result.registrationFormatMatch).toBe(0);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
  });

  it("never throws on a malformed council registration pattern", () => {
    expect(() =>
      scoreCredential({
        legalName: "Priya Sharma",
        ocrExtractedName: "Priya Sharma",
        ocrExtractedRegistrationNumber: "TG-PT-2024-001234",
        registrationNumberPattern: "(unterminated[",
        expiryDate: null,
      }),
    ).not.toThrow();
  });

  it("treats a missing OCR name as zero similarity, not a crash", () => {
    const result = scoreCredential({
      legalName: "Priya Sharma",
      ocrExtractedName: null,
      ocrExtractedRegistrationNumber: null,
      registrationNumberPattern: null,
      expiryDate: null,
    });
    expect(result.nameSimilarity).toBe(0);
  });
});
