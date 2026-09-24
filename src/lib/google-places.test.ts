// Step 5 [decision 11] — pure unit coverage for the Hyderabad-metro
// bounding check used to refuse an area-fallback proposal outside the
// pilot's one live city. The autocomplete/details fetch calls themselves
// aren't mocked/tested here, matching this file's existing scope
// (practices/actions.ts's searchPlaceSuggestions has no fetch-mock test
// either) — this is the one piece of real, mock-free logic to verify.

import { describe, expect, it } from "vitest";
import { isWithinHyderabadMetro } from "./google-places";

describe("isWithinHyderabadMetro", () => {
  it("accepts a coordinate inside Hyderabad (Hitech City)", () => {
    expect(isWithinHyderabadMetro(17.4483, 78.3915)).toBe(true);
  });

  it("accepts a coordinate near the metro's outer edge (Shamshabad)", () => {
    expect(isWithinHyderabadMetro(17.2403, 78.4294)).toBe(true);
  });

  it("rejects a coordinate in a different city (Bengaluru)", () => {
    expect(isWithinHyderabadMetro(12.9716, 77.5946)).toBe(false);
  });

  it("rejects a coordinate in a different city (Mumbai)", () => {
    expect(isWithinHyderabadMetro(19.076, 72.8777)).toBe(false);
  });

  it("rejects a coordinate just outside the bounding box", () => {
    expect(isWithinHyderabadMetro(18.0, 78.4)).toBe(false);
  });
});
