// Split out of practices/actions.ts: a "use server" file can only export
// async functions (plus types, which erase) — a class export is a real
// runtime value and broke the client bundle the moment this file's
// searchPlaceSuggestions was actually imported from a client component
// for the first time (Phase 3's PlacesAutocomplete). Not caught earlier
// because nothing imported this module before then.
export const PLACE_SEARCH_RATE_LIMIT = 60;

export class PlaceSearchRateLimitError extends Error {
  constructor() {
    super(`No more than ${PLACE_SEARCH_RATE_LIMIT} place searches per person per hour`);
    this.name = "PlaceSearchRateLimitError";
  }
}
