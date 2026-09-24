// §6 — Google Places for practice addresses. Places Autocomplete with a
// sessionToken + 300ms debounce (plan §6), google_place_id stored as the
// canonical identifier.
//
// Step 5 [decision 11] adds a second, narrower use: a therapist whose
// locality isn't in the curated `areas` tree can search Places to propose
// one, bounded to Hyderabad metro and landing as a `pending_review` areas
// row (see src/lib/areas.ts and src/app/app/areas/actions.ts) — an admin
// approves it before it's ever used for matching or directory display.
// That's a deliberate, narrow exception to the tree's curated-only rule,
// not a reopening of it: an *unreviewed* Places result is never wired
// directly into matching, only ever a pending proposal a human confirms.
//
// Server-side only, deliberately: the API key never reaches the browser.
// Workers requests originate from Cloudflare's shared edge IPs, not a
// fixed IP an API-key restriction could pin to, so keeping the key off
// the client entirely is the actual security boundary here, not a
// referrer/IP restriction on a client-exposed key.

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places";

interface PlacesEnv {
  GOOGLE_PLACES_API_KEY: string;
}

export interface PlacePrediction {
  placeId: string;
  text: string;
}

export interface PlaceDetails {
  placeId: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
}

async function fetchAutocomplete(
  env: PlacesEnv,
  input: string,
  sessionToken: string,
  locationRestriction?: { rectangle: { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } } },
): Promise<PlacePrediction[]> {
  const response = await fetch(AUTOCOMPLETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY,
    },
    body: JSON.stringify({
      input,
      sessionToken,
      // Scoped to India, since the pilot is Hyderabad-only (plan §2) —
      // avoids Places suggesting addresses this product will never serve.
      includedRegionCodes: ["in"],
      ...(locationRestriction ? { locationRestriction } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Places autocomplete failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    suggestions?: { placePrediction: { placeId: string; text: { text: string } } }[];
  };

  return (data.suggestions ?? []).map((s) => ({
    placeId: s.placePrediction.placeId,
    text: s.placePrediction.text.text,
  }));
}

/**
 * Autocomplete predictions for a practice address search. `sessionToken`
 * must be the same value across a user's typing session and the
 * subsequent getPlaceDetails call — that's what makes Places bill the
 * whole session as one lookup instead of per-keystroke (plan §6).
 */
export async function autocompletePlaces(
  env: PlacesEnv,
  input: string,
  sessionToken: string,
): Promise<PlacePrediction[]> {
  return fetchAutocomplete(env, input, sessionToken);
}

// Step 5 — a rough bounding rectangle around Hyderabad metro (the pilot's
// only live city, plan §2). Deliberately generous rather than tight: a
// locality just inside the ring road should never be wrongly rejected,
// and a rejection here isn't fatal — decision 11 routes it to the
// city-pledge waitlist (Step 6) instead of silently failing.
const HYDERABAD_METRO_BOUNDS = {
  low: { latitude: 17.15, longitude: 78.2 },
  high: { latitude: 17.65, longitude: 78.75 },
};

export function isWithinHyderabadMetro(latitude: number, longitude: number): boolean {
  return (
    latitude >= HYDERABAD_METRO_BOUNDS.low.latitude &&
    latitude <= HYDERABAD_METRO_BOUNDS.high.latitude &&
    longitude >= HYDERABAD_METRO_BOUNDS.low.longitude &&
    longitude <= HYDERABAD_METRO_BOUNDS.high.longitude
  );
}

/**
 * Step 5 [decision 11] — the "my area isn't listed" fallback search,
 * restricted (not merely biased) to Hyderabad metro via `locationRestriction`
 * so it can never surface a result outside the pilot city. Still followed
 * by getPlaceDetails + isWithinHyderabadMetro before anything is written —
 * a rectangle restriction narrows results, it doesn't guarantee every
 * result's precise coordinate lands inside it.
 */
export async function autocompleteAreaPlaces(
  env: PlacesEnv,
  input: string,
  sessionToken: string,
): Promise<PlacePrediction[]> {
  return fetchAutocomplete(env, input, sessionToken, { rectangle: HYDERABAD_METRO_BOUNDS });
}

/** Resolves a placeId (from autocompletePlaces) into the canonical fields practices stores. */
export async function getPlaceDetails(
  env: PlacesEnv,
  placeId: string,
  sessionToken: string,
): Promise<PlaceDetails> {
  const url = `${PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;

  const response = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": "id,formattedAddress,location",
    },
  });

  if (!response.ok) {
    throw new Error(`Places details failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    id: string;
    formattedAddress: string;
    location: { latitude: number; longitude: number };
  };

  return {
    placeId: data.id,
    formattedAddress: data.formattedAddress,
    latitude: data.location.latitude,
    longitude: data.location.longitude,
  };
}
