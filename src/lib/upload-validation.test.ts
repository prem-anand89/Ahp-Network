import { describe, expect, it } from "vitest";
import {
  validateUpload,
  PHOTO_MAX_BYTES,
  CREDENTIAL_DOCUMENT_MAX_BYTES,
} from "./upload-validation";

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // "MZ" — Windows executable

describe("validateUpload (§7 — never trust extension or reported MIME type)", () => {
  it("accepts a real PDF for credential_document", () => {
    expect(validateUpload("credential_document", 1024, PDF_BYTES).valid).toBe(true);
  });

  it("accepts real JPEG and PNG for photo", () => {
    expect(validateUpload("photo", 1024, JPEG_BYTES).valid).toBe(true);
    expect(validateUpload("photo", 1024, PNG_BYTES).valid).toBe(true);
  });

  it("rejects a renamed executable claiming to be a PDF, by magic bytes", () => {
    const result = validateUpload("credential_document", 1024, EXE_BYTES);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/magic bytes/);
  });

  it("rejects a PDF submitted as a photo — PDF isn't in the photo whitelist", () => {
    expect(validateUpload("photo", 1024, PDF_BYTES).valid).toBe(false);
  });

  it("rejects a photo over the 10MB cap", () => {
    const result = validateUpload("photo", PHOTO_MAX_BYTES + 1, JPEG_BYTES);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/10MB/);
  });

  it("rejects a credential document over the 5MB cap", () => {
    const result = validateUpload("credential_document", CREDENTIAL_DOCUMENT_MAX_BYTES + 1, PDF_BYTES);
    expect(result.valid).toBe(false);
  });

  it("rejects an empty file", () => {
    expect(validateUpload("photo", 0, JPEG_BYTES).valid).toBe(false);
  });
});
