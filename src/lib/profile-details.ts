// Phase 2 — the missing screen. Nothing in the app writes photoUrl,
// specializations, bio, ageGroupsServed, yearsExperience, or languages
// before this: onboarding only ever writes displayName/role/slug/one
// home-visit area. A perfectly-restyled ProfileCard still renders four
// lines in a beautiful box without this.

import { eq } from "drizzle-orm";
import type { getDb } from "@/db/db";
import { users, SPECIALIZATION_TYPE_VALUES, ageGroupTypeEnum, type SpecializationType } from "@/db/schema";

type Db = Awaited<ReturnType<typeof getDb>>;

const BIO_MAX_CHARS = 500;
const MAX_YEARS_EXPERIENCE = 60;

export interface ProfileDetailsInput {
  capacityState: "available" | "limited" | "not_taking";
  capacityNote?: string;
  availableFrom?: string;
  /** Set only when a new photo was uploaded this save — omit to leave
   * the existing photoUrl untouched, never to clear it. */
  photoUrl?: string;
  specializations: string[];
  ageGroupsServed: string[];
  bio: string;
  yearsExperience?: number;
  languages: string[];
  teleRehabAvailable: boolean;
  acceptsHomeVisits: boolean;
  acceptsClinicVisits: boolean;
}

export class ProfileDetailsValidationError extends Error {}

function assertKnownValues(values: string[], allowed: readonly string[], fieldName: string): void {
  for (const value of values) {
    if (!allowed.includes(value)) {
      throw new ProfileDetailsValidationError(`Unknown ${fieldName} value: ${value}`);
    }
  }
}

export function validateProfileDetailsInput(input: ProfileDetailsInput): void {
  if (!["available", "limited", "not_taking"].includes(input.capacityState)) {
    throw new ProfileDetailsValidationError("Invalid capacity state");
  }
  assertKnownValues(input.specializations, SPECIALIZATION_TYPE_VALUES, "specialization");
  assertKnownValues(input.ageGroupsServed, ageGroupTypeEnum.enumValues, "age group");

  if (input.bio.length > BIO_MAX_CHARS) {
    throw new ProfileDetailsValidationError(`Bio must be ${BIO_MAX_CHARS} characters or fewer`);
  }
  if (
    input.yearsExperience !== undefined &&
    (input.yearsExperience < 0 || input.yearsExperience > MAX_YEARS_EXPERIENCE)
  ) {
    throw new ProfileDetailsValidationError(`Years of experience must be between 0 and ${MAX_YEARS_EXPERIENCE}`);
  }
  if (!input.acceptsHomeVisits && !input.acceptsClinicVisits) {
    throw new ProfileDetailsValidationError("At least one of home or clinic visits must stay on");
  }
}

export async function updateProfileDetailsTx(db: Db, userId: string, input: ProfileDetailsInput): Promise<void> {
  validateProfileDetailsInput(input);

  await db
    .update(users)
    .set({
      ...(input.photoUrl !== undefined ? { photoUrl: input.photoUrl } : {}),
      specializations: input.specializations as SpecializationType[],
      ageGroupsServed: input.ageGroupsServed as (typeof ageGroupTypeEnum.enumValues)[number][],
      bio: input.bio.length > 0 ? input.bio : null,
      yearsExperience: input.yearsExperience ?? null,
      languages: input.languages,
      teleRehabAvailable: input.teleRehabAvailable,
      acceptsHomeVisits: input.acceptsHomeVisits,
      acceptsClinicVisits: input.acceptsClinicVisits,
      capacityState: input.capacityState,
      capacityNote: input.capacityNote ?? null,
      availableFrom: input.availableFrom || null,
      availabilityUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}
