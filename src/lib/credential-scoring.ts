// §8A2 — OCR confidence scoring. HARD RULE: this feeds admin queue
// PRIORITY ONLY. It never writes credentials.status or
// users.verification_stage — recompute_verification_stage() (drizzle/0010)
// is the only thing that does, and it doesn't reference this number at all.
//
// name similarity (0-50) + registration-number format match (0-30) +
// expiry sanity (0-20) — plan §8A2's exact weighting.

export interface ScoringInput {
  /** users.legal_name, collected at credential upload, never displayed. */
  legalName: string;
  /** Name as OCR extracted it from the document. */
  ocrExtractedName: string | null;
  /** Registration number as OCR extracted it, if this is a council_registration. */
  ocrExtractedRegistrationNumber: string | null;
  /** master_councils.registration_number_pattern for the selected council, if any. */
  registrationNumberPattern: string | null;
  /** OCR-extracted or self-declared expiry date, if present. */
  expiryDate: Date | null;
}

export interface ScoringResult {
  confidenceScore: number; // 0-100, higher = more confident, higher queue priority
  nameSimilarity: number;
  registrationFormatMatch: number;
  expirySanity: number;
}

/**
 * Normalized Levenshtein-based similarity, 0-50. Not pg_trgm's trigram
 * similarity — this runs before the row exists to query against, at OCR
 * completion time, in the Worker that received the Vision response. A
 * simple edit-distance ratio is adequate for "how close are these two
 * names," which is all this number is used for (queue ordering).
 */
function nameSimilarityScore(a: string, b: string | null): number {
  if (!b) return 0;
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const na = normalize(a);
  const nb = normalize(b);
  if (na.length === 0 || nb.length === 0) return 0;

  const distance = levenshteinDistance(na, nb);
  const similarity = 1 - distance / Math.max(na.length, nb.length);
  return Math.round(Math.max(0, similarity) * 50);
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, (_, i) => [
    i,
    ...Array(cols - 1).fill(0),
  ]);
  for (let j = 0; j < cols; j++) matrix[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[rows - 1][cols - 1];
}

function registrationFormatScore(
  extracted: string | null,
  pattern: string | null,
): number {
  if (!extracted || !pattern) return 0;
  try {
    return new RegExp(pattern).test(extracted.trim()) ? 30 : 0;
  } catch {
    // A malformed pattern in master_councils shouldn't crash this check —
    // it just means this credential gets 0 on this dimension and sits
    // lower in the queue, still requiring the same human review either way.
    return 0;
  }
}

function expirySanityScore(expiryDate: Date | null): number {
  if (!expiryDate) return 10; // no expiry extracted — neutral, not penalized
  const now = new Date();
  const tenYearsOut = new Date(now);
  tenYearsOut.setFullYear(tenYearsOut.getFullYear() + 10);
  // A registration already expired, or implausibly far in the future, is
  // more likely an OCR misread than a real edge case — lower priority.
  return expiryDate > now && expiryDate < tenYearsOut ? 20 : 0;
}

export function scoreCredential(input: ScoringInput): ScoringResult {
  const nameSimilarity = nameSimilarityScore(input.legalName, input.ocrExtractedName);
  const registrationFormatMatch = registrationFormatScore(
    input.ocrExtractedRegistrationNumber,
    input.registrationNumberPattern,
  );
  const expirySanity = expirySanityScore(input.expiryDate);

  return {
    confidenceScore: nameSimilarity + registrationFormatMatch + expirySanity,
    nameSimilarity,
    registrationFormatMatch,
    expirySanity,
  };
}
