"use server";

// Step 5 [decision 11] — "my area isn't listed." A therapist whose
// locality isn't in the curated areas tree can search Google Places
// (bounded to Hyderabad metro) and propose one. The new row lands as
// pending_review immediately, usable by the person who added it right
// away (their own form doesn't stall on a human), but excluded from
// matching/directory for everyone else until an admin approves it
// (referral-matching.ts, directory.ts, areas.ts).

import { and, count, eq, gte } from "drizzle-orm";
import { areas, placeSearchEvents } from "@/db/schema";
import { autocompleteAreaPlaces, getPlaceDetails, isWithinHyderabadMetro } from "@/lib/google-places";
import { AREA_OUTSIDE_HYDERABAD_ERROR } from "@/lib/copy";
import { PLACE_SEARCH_RATE_LIMIT, PlaceSearchRateLimitError } from "@/lib/place-search-errors";
import { requireAuthedTherapist } from "@/lib/require-session";
import { getRuntimeEnv } from "@/lib/runtime-env";

interface SecretsEnv {
  GOOGLE_PLACES_API_KEY: string;
}

/** Same 60/hour bucket as practice-address search (practices/actions.ts)
 * — one person's total Places usage, not a separate quota per use case. */
export async function searchAreaPlaceSuggestions(query: string, sessionToken: string) {
  const { db, userId } = await requireAuthedTherapist();

  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [{ recent }] = await db
    .select({ recent: count() })
    .from(placeSearchEvents)
    .where(and(eq(placeSearchEvents.userId, userId), gte(placeSearchEvents.createdAt, since)));
  if (recent >= PLACE_SEARCH_RATE_LIMIT) throw new PlaceSearchRateLimitError();

  await db.insert(placeSearchEvents).values({ userId });

  const env = await getRuntimeEnv<SecretsEnv>();
  return autocompleteAreaPlaces(env, query, sessionToken);
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "area"
  );
}

export interface ProposedArea {
  id: string;
  name: string;
}

/**
 * Dedupes on Places place_id — two therapists proposing the same real
 * place land on the same pending row, never two. Refuses anything outside
 * Hyderabad metro (isWithinHyderabadMetro, checked against the resolved
 * place coordinates, not just the bounded autocomplete call — a
 * locationRestriction narrows results, it doesn't guarantee every result
 * is precisely inside it); outside Hyderabad is the city-pledge
 * waitlist's territory (decision 1), not this path.
 */
export async function proposeAreaFromPlace(
  placeId: string,
  placeText: string,
  sessionToken: string,
): Promise<ProposedArea> {
  const { db } = await requireAuthedTherapist();

  const [existing] = await db
    .select({ id: areas.id, name: areas.name })
    .from(areas)
    .where(eq(areas.googlePlaceId, placeId));
  if (existing) return existing;

  const env = await getRuntimeEnv<SecretsEnv>();
  const details = await getPlaceDetails(env, placeId, sessionToken);
  if (!isWithinHyderabadMetro(details.latitude, details.longitude)) {
    throw new Error(AREA_OUTSIDE_HYDERABAD_ERROR);
  }

  const name = placeText.trim() || details.formattedAddress;
  const base = slugify(name);
  let slug = base;
  for (let attempt = 1; ; attempt++) {
    const [conflict] = await db.select({ id: areas.id }).from(areas).where(eq(areas.slug, slug));
    if (!conflict) break;
    slug = `${base}-${attempt + 1}`;
  }

  const [inserted] = await db
    .insert(areas)
    .values({
      name,
      slug,
      areaLevel: "locality",
      curationStatus: "pending_review",
      googlePlaceId: placeId,
    })
    .onConflictDoNothing()
    .returning({ id: areas.id, name: areas.name });
  if (inserted) return inserted;

  // Lost a race with a concurrent proposal for the same place (the
  // pre-check above and this insert aren't one transaction) — re-read
  // rather than erroring.
  const [raced] = await db
    .select({ id: areas.id, name: areas.name })
    .from(areas)
    .where(eq(areas.googlePlaceId, placeId));
  if (!raced) throw new Error("Please try again.");
  return raced;
}
