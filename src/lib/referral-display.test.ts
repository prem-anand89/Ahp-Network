// One test per row of §8D's display-wording table (ahp-network-plan-v19.md,
// "Display wording — plain language, not the internal enum"), per
// BUILD_SEQUENCE.md Phase 6's requirement that this stay a pure function
// with a snapshot test per row — the wording/internal-enum separation
// only survives if something breaks when either side drifts.

import { describe, expect, it } from "vitest";
import { displayFor } from "./referral-display";

describe("displayFor — §8D display-wording table", () => {
  it("row: open, no interest yet", () => {
    expect(displayFor({ kind: "open_no_interest" }, "poster")).toEqual({
      label: "Posted",
      detail: "Waiting for responses",
    });
    expect(displayFor({ kind: "open_no_interest" }, "receiving_therapist")).toEqual({
      label: "Open",
      detail: "Near you",
    });
  });

  it("row: interest exists, not shortlisted", () => {
    expect(
      displayFor({ kind: "interest_no_shortlist", interestedCount: 3 }, "poster"),
    ).toEqual({ label: "3 interested", detail: "Tap to choose" });
    expect(
      displayFor({ kind: "interest_no_shortlist", interestedCount: 3 }, "receiving_therapist"),
    ).toEqual({ label: "Interested", detail: "Awaiting their decision" });
  });

  it("row: shortlisted", () => {
    const state = {
      kind: "shortlisted" as const,
      offerWindowLabel: "2h",
      offeredToName: "Priya",
    };
    expect(displayFor(state, "poster")).toEqual({ label: "Offered", detail: "Sent to Priya" });
    expect(displayFor(state, "receiving_therapist")).toEqual({
      label: "Offered to you",
      detail: "Accept within 2h",
    });
  });

  it("row: accepted (relay — the pilot path)", () => {
    const state = { kind: "accepted_relay" as const, accepterName: "Rahul" };
    expect(displayFor(state, "poster")).toEqual({
      label: "Share details",
      detail: "Give your patient Rahul's number",
    });
    expect(displayFor(state, "receiving_therapist")).toEqual({
      label: "Accepted",
      detail: "Your details have been shared",
    });
  });

  it("row: awaiting poster confirmation", () => {
    const state = { kind: "awaiting_poster_confirmation" as const };
    expect(displayFor(state, "poster")).toEqual({
      label: "Did they connect?",
      detail: "Yes / didn't work out",
    });
    expect(displayFor(state, "receiving_therapist")).toEqual({
      label: "Accepted",
      detail: "Awaiting confirmation",
    });
  });

  it("row: accepted, direct mode (dormant for the entire pilot)", () => {
    const state = {
      kind: "accepted_direct_dormant" as const,
      accepterName: "Rahul",
      contactWindowLabel: "2h",
    };
    expect(displayFor(state, "poster")).toEqual({
      label: "Accepted",
      detail: "Rahul is calling the patient",
    });
    expect(displayFor(state, "receiving_therapist")).toEqual({
      label: "Call the patient",
      detail: "within 2h",
    });
  });

  it("row: completed", () => {
    expect(displayFor({ kind: "completed" }, "poster")).toEqual({ label: "Done", detail: "" });
    expect(displayFor({ kind: "completed" }, "receiving_therapist")).toEqual({
      label: "Done",
      detail: "",
    });
  });

  it("row: rerouted, sibling lost the race — [v20]/§G3 emotional-work wording", () => {
    const state = {
      kind: "rerouted_lost_race" as const,
      wonByName: "Priya",
      interestedCount: 5,
    };
    expect(displayFor(state, "poster")).toEqual({ label: "Rerouted", detail: "Now with Priya" });
    expect(displayFor(state, "receiving_therapist")).toEqual({
      label: "Priya accepted this one first",
      detail: "you were one of 2 chosen out of 5 interested",
    });
  });

  it("row: offer window closed unanswered (missed) — [v20]", () => {
    const state = { kind: "missed" as const, offeredToName: "Priya" };
    expect(displayFor(state, "poster")).toEqual({
      label: "No answer",
      detail: "Priya didn't respond in time",
    });
    expect(displayFor(state, "receiving_therapist")).toEqual({
      label: "Offer expired",
      detail: "you can still express interest if it's reposted",
    });
  });

  it("row: therapist actively declined — [v20]", () => {
    const state = { kind: "declined" as const, declinedByName: "Priya" };
    expect(displayFor(state, "poster")).toEqual({
      label: "Declined",
      detail: "Priya can't take this one",
    });
    expect(displayFor(state, "receiving_therapist")).toEqual({
      label: "Declined",
      detail: "you told them you can't take this one",
    });
  });

  it("row: expired — no receiving-therapist wording in the table", () => {
    expect(displayFor({ kind: "expired" }, "poster")).toEqual({
      label: "Closed",
      detail: "No responses",
    });
    expect(displayFor({ kind: "expired" }, "receiving_therapist")).toBeNull();
  });
});
