// Shared plain-language labels for §8D's structured referral fields —
// one place so the posting form, the board list, and the detail page
// never drift from each other.

export const ROLE_NEEDED_LABELS: Record<string, string> = {
  physiotherapist: "Physiotherapist",
  occupational_therapist: "Occupational Therapist",
  speech_language_pathologist: "Speech-Language Pathologist",
};

export const SPECIALIZATION_LABELS: Record<string, string> = {
  musculoskeletal_orthopaedic: "Musculoskeletal / Orthopaedic",
  neuro_rehab: "Neuro Rehab",
};

// Profile Card addendum §3 — display-only, alongside specializations in
// the Clinical Practice Focus tags. Never widens the specialization_type
// matching enum itself.
export const AGE_GROUP_LABELS: Record<string, string> = {
  pediatric: "Pediatric",
  adult: "Adult",
  geriatric: "Geriatric",
};

export function timeAgoLabel(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
