// §7's upload security rules, centralized: file-type whitelist, size caps
// as configurable constants (not scattered magic numbers), and magic-byte
// validation — never trust a file extension or browser-reported MIME type,
// both are trivially spoofable by whoever controls the upload request.

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024; // 10MB
export const CREDENTIAL_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024; // 5MB

export type UploadKind = "photo" | "credential_document";

const PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const CREDENTIAL_MIME_TYPES = new Set(["application/pdf"]);

export function maxBytesFor(kind: UploadKind): number {
  return kind === "photo" ? PHOTO_MAX_BYTES : CREDENTIAL_DOCUMENT_MAX_BYTES;
}

export function allowedMimeTypesFor(kind: UploadKind): Set<string> {
  return kind === "photo" ? PHOTO_MIME_TYPES : CREDENTIAL_MIME_TYPES;
}

// Magic-byte signatures — checked against the file's actual leading bytes,
// never the extension or the browser's reported Content-Type.
const MAGIC_BYTES: Record<string, (bytes: Uint8Array) => boolean> = {
  "application/pdf": (b) =>
    b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d, // "%PDF-"
  "image/jpeg": (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) =>
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a,
  "image/webp": (b) =>
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50,
};

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates a file's actual content against a claimed kind — size cap,
 * and magic bytes checked against every MIME type allowed for that kind
 * (not just whichever type the browser claims), so a renamed .exe claiming
 * to be a PDF is rejected regardless of what the caller says it is.
 */
export function validateUpload(
  kind: UploadKind,
  sizeBytes: number,
  leadingBytes: Uint8Array,
): ValidationResult {
  const maxBytes = maxBytesFor(kind);
  if (sizeBytes > maxBytes) {
    return { valid: false, reason: `File exceeds the ${maxBytes / (1024 * 1024)}MB limit for ${kind}` };
  }
  if (sizeBytes <= 0) {
    return { valid: false, reason: "Empty file" };
  }

  const allowedTypes = allowedMimeTypesFor(kind);
  const matchesAnyAllowedType = [...allowedTypes].some((mime) => MAGIC_BYTES[mime]?.(leadingBytes));

  if (!matchesAnyAllowedType) {
    return {
      valid: false,
      reason: `File content doesn't match any allowed type for ${kind} (checked by magic bytes, not extension)`,
    };
  }

  return { valid: true };
}
