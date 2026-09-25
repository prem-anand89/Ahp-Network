// Round 2 step 6 (plan decisions 1 & 2) — pure, client-safe constants
// split out of pledges.ts. pledges.ts imports `@/db/schema` and Drizzle
// query builders, which a client component must never pull into its
// bundle by importing a value from that module (place-search-errors.ts
// documents this exact failure mode for "use server" files; the same
// risk applies to any server-only lib). This file has zero server-only
// imports, so both pledges.ts and client components can import it
// directly.

// Decision 1 states "25 pledged therapists" explicitly for city unlock.
// Decision 2 says community pledges use "the same pledge table/mechanics
// as city unlock — build once, two targets" without stating a separate
// number, so this reuses the same 25 for community proposals too, rather
// than inventing an unstated second constant.
export const PLEDGE_THRESHOLD = 25;

// Round 3 step E — PLEDGE_CITY_OPTIONS (a short hand-picked list) is
// retired: cities now come from the national areas registry via
// CityPicker, the same picker onboarding/referrals use, rather than a
// separate fixed list that would drift from what's actually curated.
