// Phase 2 — option lists for the profile editor's ChipMultiSelect fields.
// Specialty and age-group options are derived from the DB enums
// themselves (specializationTypeEnum/ageGroupTypeEnum) through the
// existing label dictionaries in referral-labels.ts, so this file never
// drifts from the schema and the taxonomy-expansion step just adds
// entries to those two places, not a third list here.

import { specializationTypeEnum, ageGroupTypeEnum } from "@/db/schema";
import { SPECIALIZATION_LABELS, AGE_GROUP_LABELS } from "./referral-labels";
import type { ChipMultiSelectOption } from "@/components/forms/chip-multi-select";

export const SPECIALIZATION_OPTIONS: ChipMultiSelectOption[] = specializationTypeEnum.enumValues.map(
  (value) => ({ value, label: SPECIALIZATION_LABELS[value] ?? value }),
);

export const AGE_GROUP_OPTIONS: ChipMultiSelectOption[] = ageGroupTypeEnum.enumValues.map((value) => ({
  value,
  label: AGE_GROUP_LABELS[value] ?? value,
}));

// languages is a free-text array column (no DB enum — a therapist could
// in principle list something not on this curated list), so this is an
// app-level suggestion set only, not a validated whitelist. Covers the
// languages most commonly spoken by patients/therapists in the pilot's
// Hyderabad/Telangana market.
export const LANGUAGE_OPTIONS: ChipMultiSelectOption[] = [
  { value: "English", label: "English" },
  { value: "Hindi", label: "Hindi" },
  { value: "Telugu", label: "Telugu" },
  { value: "Urdu", label: "Urdu" },
  { value: "Tamil", label: "Tamil" },
  { value: "Kannada", label: "Kannada" },
  { value: "Marathi", label: "Marathi" },
];
