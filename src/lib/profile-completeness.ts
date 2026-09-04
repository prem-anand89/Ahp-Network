// §9's sort order, tier 3: profile completeness. Feeds directory ordering
// ONLY — never displayed to the therapist or the public as a number,
// percentage, or progress bar (that would be exactly the kind of
// comparative language surfaced to users that §1A bans). Internal
// ordering input only.

export interface CompletenessInput {
  bio: string | null;
  photoUrl: string | null;
  languages: string[] | null;
  yearsExperience: number | null;
  specializations: unknown[];
  ageGroupsServed: unknown[];
  availabilityNotes: string | null;
}

const WEIGHTS = {
  bio: 20,
  photo: 20,
  languages: 15,
  yearsExperience: 15,
  specializations: 15,
  ageGroupsServed: 10,
  availabilityNotes: 5,
} as const;

export function profileCompletenessScore(input: CompletenessInput): number {
  let total = 0;
  if (input.bio && input.bio.trim().length > 0) total += WEIGHTS.bio;
  if (input.photoUrl) total += WEIGHTS.photo;
  if (input.languages && input.languages.length > 0) total += WEIGHTS.languages;
  if (input.yearsExperience !== null && input.yearsExperience > 0) total += WEIGHTS.yearsExperience;
  if (input.specializations.length > 0) total += WEIGHTS.specializations;
  if (input.ageGroupsServed.length > 0) total += WEIGHTS.ageGroupsServed;
  if (input.availabilityNotes && input.availabilityNotes.trim().length > 0) total += WEIGHTS.availabilityNotes;
  return total;
}
