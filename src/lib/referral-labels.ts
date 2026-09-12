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

// REFERRAL_LOOP_SPEC_ADDENDUM.md §3-4 — stable DB keys (referral-outcomes.ts)
// map to display words here, so any label can be reworded without a
// migration. Order matches the addendum's display order.
export const REFERRAL_OUTCOME_LABELS: Record<string, string> = {
  no_patient_contact: "No contact from patient",
  contacted_not_started: "Contacted, not started",
  first_session_done: "First session done",
  ongoing: "Ongoing",
  completed_discharged: "Completed / discharged",
  not_suitable_referred_on: "Not suitable — referred on",
  discontinued: "Discontinued",
};

// Display order by expected frequency, 'Other' last — a dropdown scanned
// in a hurry, not prose. 'mismatch' and 'not_comfortable' are deliberately
// both present and are not duplicates: the first is a neutral statement
// about fit, the second is the patient's own discomfort. Neither assigns
// fault to the receiving therapist.
export const DISCONTINUED_REASON_LABELS: Record<string, string> = {
  switched_therapist: "Switched therapist",
  not_responding: "Not responding",
  cost: "Cost",
  travel_distance: "Travel/distance",
  improved: "Improved",
  mismatch: "Mismatch",
  not_comfortable: "Not comfortable",
  medical_reason: "Medical reason",
  relocated: "Relocated",
  other: "Other",
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
