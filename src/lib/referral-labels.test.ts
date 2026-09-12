import { describe, expect, it } from "vitest";
import { DISCONTINUED_REASON_LABELS, REFERRAL_OUTCOME_LABELS } from "./referral-labels";
import { DISCONTINUED_REASON_KEYS, REFERRAL_OUTCOME_KEYS } from "./referral-outcomes";

// REFERRAL_LOOP_SPEC_ADDENDUM.md §12: "every outcome key and every
// discontinued-reason key has a label in copy.ts" — labels actually live
// in referral-labels.ts (same module as every other referral-field label),
// but the completeness guarantee is the same one the spec asks for: the
// stable DB keys and the display-label maps must never drift apart.
describe("referral outcome / discontinued-reason label completeness", () => {
  it("has a label for every REFERRAL_OUTCOME_KEYS entry, and no extras", () => {
    expect(Object.keys(REFERRAL_OUTCOME_LABELS).sort()).toEqual([...REFERRAL_OUTCOME_KEYS].sort());
  });

  it("has a label for every DISCONTINUED_REASON_KEYS entry, and no extras", () => {
    expect(Object.keys(DISCONTINUED_REASON_LABELS).sort()).toEqual([...DISCONTINUED_REASON_KEYS].sort());
  });
});
