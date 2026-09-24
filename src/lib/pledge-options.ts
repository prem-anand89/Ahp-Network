// Round 2 step 6 (plan decisions 1 & 2) — pure, client-safe constants
// split out of pledges.ts. pledges.ts imports `@/db/schema` and Drizzle
// query builders, which a client component must never pull into its
// bundle by importing a value from that module (place-search-errors.ts
// documents this exact failure mode for "use server" files; the same
// risk applies to any server-only lib). This file has zero server-only
// imports, so both pledges.ts and client components (city-pledge-
// fallback.tsx) can import it directly.

// Decision 1 states "25 pledged therapists" explicitly for city unlock.
// Decision 2 says community pledges use "the same pledge table/mechanics
// as city unlock — build once, two targets" without stating a separate
// number, so this reuses the same 25 for community proposals too, rather
// than inventing an unstated second constant.
export const PLEDGE_THRESHOLD = 25;

/** A short, hand-picked list — free-text city entry would fragment counts
 * on spelling/casing ("Bengaluru" vs "Bangalore") and this only needs to
 * cover plausible next-city candidates, not every Indian city. `state`
 * feeds the unlock prerequisite check (a state's statutory council must
 * exist in master_councils before that state's therapists can ever reach
 * credentials_verified — TGPMB is Telangana-only). */
export const PLEDGE_CITY_OPTIONS: { name: string; state: string }[] = [
  { name: "Bengaluru", state: "Karnataka" },
  { name: "Mumbai", state: "Maharashtra" },
  { name: "Pune", state: "Maharashtra" },
  { name: "Chennai", state: "Tamil Nadu" },
  { name: "Delhi NCR", state: "Delhi" },
  { name: "Kolkata", state: "West Bengal" },
  { name: "Ahmedabad", state: "Gujarat" },
  { name: "Kochi", state: "Kerala" },
];

export function isPledgeCityOption(city: string): boolean {
  return PLEDGE_CITY_OPTIONS.some((c) => c.name === city);
}
