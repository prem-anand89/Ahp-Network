// Phase 2 — option lists for the profile editor's ChipMultiSelect fields.
// Specialty and age-group options are derived from the DB source of
// truth (SPECIALIZATION_TYPE_VALUES / ageGroupTypeEnum) through the
// existing label dictionaries in referral-labels.ts, so this file never
// drifts from the schema and the taxonomy-expansion step just adds
// entries to those two places, not a third list here.

import { SPECIALIZATION_TYPE_VALUES, ageGroupTypeEnum } from "@/db/schema";
import { SPECIALIZATION_LABELS, AGE_GROUP_LABELS } from "./referral-labels";
import type { ChipMultiSelectOption } from "@/components/forms/chip-multi-select";

export const SPECIALIZATION_OPTIONS: ChipMultiSelectOption[] = SPECIALIZATION_TYPE_VALUES.map(
  (value) => ({ value, label: SPECIALIZATION_LABELS[value] ?? value }),
);

export const AGE_GROUP_OPTIONS: ChipMultiSelectOption[] = ageGroupTypeEnum.enumValues.map((value) => ({
  value,
  label: AGE_GROUP_LABELS[value] ?? value,
}));

// languages is a free-text array column (no DB enum — a therapist could
// in principle list something not on this curated list), so this is an
// app-level suggestion set only, not a validated whitelist. Round 3 —
// widened from the pilot's Hyderabad/Telangana-only list to the major
// languages a national user base and their patients actually speak
// (the largest Scheduled Languages by speaker count); a language not
// listed here is still enterable as free text, this just picks what's
// offered as a one-tap chip.
export const LANGUAGE_OPTIONS: ChipMultiSelectOption[] = [
  { value: "English", label: "English" },
  { value: "Hindi", label: "Hindi" },
  { value: "Bengali", label: "Bengali" },
  { value: "Telugu", label: "Telugu" },
  { value: "Marathi", label: "Marathi" },
  { value: "Tamil", label: "Tamil" },
  { value: "Urdu", label: "Urdu" },
  { value: "Gujarati", label: "Gujarati" },
  { value: "Kannada", label: "Kannada" },
  { value: "Malayalam", label: "Malayalam" },
  { value: "Punjabi", label: "Punjabi" },
  { value: "Odia", label: "Odia" },
  { value: "Assamese", label: "Assamese" },
];
