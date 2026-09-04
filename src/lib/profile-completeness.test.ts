import { describe, expect, it } from "vitest";
import { profileCompletenessScore } from "./profile-completeness";

const EMPTY = {
  bio: null,
  photoUrl: null,
  languages: null,
  yearsExperience: null,
  specializations: [],
  ageGroupsServed: [],
  availabilityNotes: null,
};

describe("profileCompletenessScore (§9 ranking, tier 3 — internal ordering only)", () => {
  it("scores an empty profile at zero", () => {
    expect(profileCompletenessScore(EMPTY)).toBe(0);
  });

  it("scores a fully filled profile at 100", () => {
    expect(
      profileCompletenessScore({
        bio: "Experienced physiotherapist specializing in sports injuries.",
        photoUrl: "photos/x.jpg",
        languages: ["English", "Telugu"],
        yearsExperience: 5,
        specializations: ["musculoskeletal_orthopaedic"],
        ageGroupsServed: ["adult"],
        availabilityNotes: "Weekday mornings",
      }),
    ).toBe(100);
  });

  it("treats whitespace-only bio as not filled", () => {
    expect(profileCompletenessScore({ ...EMPTY, bio: "   " })).toBe(0);
  });

  it("treats zero years experience as not filled", () => {
    expect(profileCompletenessScore({ ...EMPTY, yearsExperience: 0 })).toBe(0);
  });
});
