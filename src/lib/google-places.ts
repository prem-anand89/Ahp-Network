// §6 — Google Places for practice addresses ONLY. Places Autocomplete
// with a sessionToken + 300ms debounce (plan §6), google_place_id stored
// as the canonical identifier.
//
// Round 3 removed Step 5's one other use of this file (a Hyderabad-
// bounded "my area isn't listed" fallback) — the `areas` registry is
// India Post-sourced now (src/lib/area-search.ts, src/lib/india-post-
// loader.ts), not Google, so a locality proposal no longer touches this
// API at all. This file stays scoped to what its name says: practice
// addresses.
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
      // Scoped to India — avoids Places suggesting addresses outside the
      // country this product serves. Practice addresses only (Round 3 —
      // area picking itself uses the national areas registry, not
      // Google; see this file's own header).
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
