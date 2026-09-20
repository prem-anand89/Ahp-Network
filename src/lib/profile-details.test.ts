// Phase 2 — runs against a real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import {
  updateProfileDetailsTx,
  validateProfileDetailsInput,
  ProfileDetailsValidationError,
  type ProfileDetailsInput,
} from "./profile-details";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];

afterEach(async () => {
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createUser(): Promise<string> {
  const email = `profile-details-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type, verification_stage)
    VALUES (${authUser.id}, ${email}, 'therapist', 'unverified')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

function baseInput(overrides: Partial<ProfileDetailsInput> = {}): ProfileDetailsInput {
  return {
    specializations: ["neuro_rehab"],
    ageGroupsServed: ["adult"],
    bio: "Focused on post-stroke neuro rehab.",
    yearsExperience: 6,
    languages: ["English", "Telugu"],
    teleRehabAvailable: true,
    acceptsHomeVisits: true,
    acceptsClinicVisits: true,
    ...overrides,
  };
}

describe("validateProfileDetailsInput (Phase 2)", () => {
  it("rejects an unknown specialization value", () => {
    expect(() =>
      validateProfileDetailsInput(baseInput({ specializations: ["made_up_specialty"] })),
    ).toThrow(ProfileDetailsValidationError);
  });

  it("rejects an unknown age group value", () => {
    expect(() => validateProfileDetailsInput(baseInput({ ageGroupsServed: ["toddler"] }))).toThrow(
      ProfileDetailsValidationError,
    );
  });

  it("rejects a bio over the character cap", () => {
    expect(() => validateProfileDetailsInput(baseInput({ bio: "x".repeat(501) }))).toThrow(
      ProfileDetailsValidationError,
    );
  });

  it("rejects years of experience out of range", () => {
    expect(() => validateProfileDetailsInput(baseInput({ yearsExperience: -1 }))).toThrow(
      ProfileDetailsValidationError,
    );
    expect(() => validateProfileDetailsInput(baseInput({ yearsExperience: 61 }))).toThrow(
      ProfileDetailsValidationError,
    );
  });

  it("rejects turning off both home and clinic visits", () => {
    expect(() =>
      validateProfileDetailsInput(baseInput({ acceptsHomeVisits: false, acceptsClinicVisits: false })),
    ).toThrow(ProfileDetailsValidationError);
  });

  it("accepts a valid input", () => {
    expect(() => validateProfileDetailsInput(baseInput())).not.toThrow();
  });
});

describe("updateProfileDetailsTx (Phase 2 — the missing screen)", () => {
  it("writes every field this profile-edit screen exists to unlock", async () => {
    const userId = await createUser();

    await updateProfileDetailsTx(db, userId, baseInput({ photoUrl: "https://example.com/photo.webp" }));

    const [row] = await client`SELECT * FROM users WHERE id = ${userId}`;
    expect(row.photo_url).toBe("https://example.com/photo.webp");
    expect(row.specializations).toEqual(["neuro_rehab"]);
    expect(row.age_groups_served).toEqual(["adult"]);
    expect(row.bio).toBe("Focused on post-stroke neuro rehab.");
    expect(row.years_experience).toBe(6);
    expect(row.languages).toEqual(["English", "Telugu"]);
    expect(row.tele_rehab_available).toBe(true);
  });

  it("leaves photoUrl untouched when the caller omits it", async () => {
    const userId = await createUser();
    await updateProfileDetailsTx(db, userId, baseInput({ photoUrl: "https://example.com/first.webp" }));

    await updateProfileDetailsTx(db, userId, baseInput({ bio: "Updated bio, no new photo." }));

    const [row] = await client`SELECT * FROM users WHERE id = ${userId}`;
    expect(row.photo_url).toBe("https://example.com/first.webp");
    expect(row.bio).toBe("Updated bio, no new photo.");
  });

  it("stores an empty bio as NULL, not an empty string", async () => {
    const userId = await createUser();
    await updateProfileDetailsTx(db, userId, baseInput({ bio: "" }));
    const [row] = await client`SELECT * FROM users WHERE id = ${userId}`;
    expect(row.bio).toBeNull();
  });

  it("throws and writes nothing when the input is invalid", async () => {
    const userId = await createUser();
    await expect(
      updateProfileDetailsTx(db, userId, baseInput({ specializations: ["nonsense"] })),
    ).rejects.toThrow(ProfileDetailsValidationError);

    const [row] = await client`SELECT * FROM users WHERE id = ${userId}`;
    expect(row.specializations).toEqual([]);
  });
});
