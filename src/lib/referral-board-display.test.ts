// Phase 4 bug fix — regression coverage for posterDisplayState and
// receivingDisplay, which used to hardcode interestedCount to 0 and
// collapse shortlisted/accepted/contact_acknowledged to open_no_interest
// on the referral board, and hardcode a static "Open to respond" string
// for the receiving side's shortlisted case instead of the real offer
// window.

import { describe, expect, it } from "vitest";
import { posterDisplayState, receivingDisplay } from "./referral-board-display";

describe("posterDisplayState — the referral board's own state line", () => {
  it("shows a real interested count on an open referral, not a hardcoded 0", () => {
    expect(posterDisplayState("open", 3, [], null)).toEqual({
      kind: "interest_no_shortlist",
      interestedCount: 3,
    });
  });

  it("open with zero interest stays open_no_interest", () => {
    expect(posterDisplayState("open", 0, [], null)).toEqual({ kind: "open_no_interest" });
  });

  it("a shortlisted referral shows who it was offered to, not the generic 'Posted' fallback", () => {
    const state = posterDisplayState("shortlisted", 0, ["Priya", "Rahul"], null);
    expect(state).toEqual({
      kind: "shortlisted",
      offerWindowLabel: "",
      offeredToName: "Priya and Rahul",
    });
  });

  it("an accepted referral with a known accepter shows the share-details state", () => {
    expect(posterDisplayState("accepted", 0, [], "Priya")).toEqual({
      kind: "accepted_relay",
      accepterName: "Priya",
    });
  });

  it("an accepted referral with no accepter name loaded falls back to awaiting confirmation", () => {
    expect(posterDisplayState("accepted", 0, [], null)).toEqual({
      kind: "awaiting_poster_confirmation",
    });
  });

  it("completed and auto_closed both read as completed", () => {
    expect(posterDisplayState("completed", 0, [], null)).toEqual({ kind: "completed" });
    expect(posterDisplayState("auto_closed", 0, [], null)).toEqual({ kind: "completed" });
  });

  it("cancelled_by_poster and expired both read as expired — no row in §8D's table for cancelled_by_poster", () => {
    expect(posterDisplayState("cancelled_by_poster", 0, [], null)).toEqual({ kind: "expired" });
    expect(posterDisplayState("expired", 0, [], null)).toEqual({ kind: "expired" });
  });
});

describe("receivingDisplay — the matched-pool side's own state line", () => {
  it("a shortlisted offer shows the real remaining window, not a static 'Open to respond'", () => {
    // +25m and a few seconds of headroom — formatRemainingDuration floors
    // to whole minutes, so a bare +25m can floor to 24m by the time this
    // assertion runs.
    const expiresAt = new Date(Date.now() + 25 * 60_000 + 30_000);
    const display = receivingDisplay("shortlisted", expiresAt);
    expect(display?.label).toBe("Offered to you");
    expect(display?.detail).toBe("Accept within 25m");
  });

  it("falls back to a safe label if offerExpiresAt is somehow missing", () => {
    const display = receivingDisplay("shortlisted", null);
    expect(display?.detail).toBe("Accept within the window");
  });

  it("pending interest routes through displayFor's interest_no_shortlist row", () => {
    expect(receivingDisplay("pending", null)).toEqual({
      label: "Interested",
      detail: "Awaiting their decision",
    });
  });
});
