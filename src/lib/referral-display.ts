// §8D's display-wording layer — kept a pure function, deliberately
// separate from the internal state enum stored on home_case_referrals and
// referral_interest. The internal states (open/shortlisted/accepted/...)
// are workflow bookkeeping; what a poster or a receiving therapist reads
// on screen is a different, smaller, plain-language vocabulary that must
// never leak the internal names. BUILD_SEQUENCE.md Phase 6 requires this
// stay a pure function with a snapshot test per row of the table below —
// see referral-display.test.ts.
//
// [v20]/§G3: the "someone else won" line does real emotional work —
// "[Name] accepted this one first — you were one of 2 chosen out of N
// interested" reads as a compliment (being shortlisted at all), not a
// buzzer-race loss. Both numbers already exist on the referral by the
// time this is shown; nothing here computes them.

export type ReferralViewerRole = "poster" | "receiving_therapist";

export type ReferralDisplayState =
  | { kind: "open_no_interest" }
  | { kind: "interest_no_shortlist"; interestedCount: number }
  | { kind: "shortlisted"; offerWindowLabel: string; offeredToName: string }
  | { kind: "accepted_relay"; accepterName: string }
  | { kind: "awaiting_poster_confirmation" }
  // Direct mode is dormant for the entire pilot — no UI ever reaches this
  // state, but the row exists in §8D's table and the function stays total
  // over it so a future direct-mode build has the wording ready.
  | { kind: "accepted_direct_dormant"; accepterName: string; contactWindowLabel: string }
  | { kind: "completed" }
  | { kind: "rerouted_lost_race"; wonByName: string; interestedCount: number }
  | { kind: "missed"; offeredToName: string }
  | { kind: "declined"; declinedByName: string }
  | { kind: "expired" };

export interface ReferralDisplay {
  label: string;
  detail: string;
}

export function displayFor(
  state: ReferralDisplayState,
  viewerRole: ReferralViewerRole,
): ReferralDisplay | null {
  const isPoster = viewerRole === "poster";

  switch (state.kind) {
    case "open_no_interest":
      return isPoster
        ? { label: "Posted", detail: "Waiting for responses" }
        : { label: "Open", detail: "Near you" };

    case "interest_no_shortlist":
      return isPoster
        ? { label: `${state.interestedCount} interested`, detail: "Tap to choose" }
        : { label: "Interested", detail: "Awaiting their decision" };

    case "shortlisted":
      return isPoster
        ? { label: "Offered", detail: `Sent to ${state.offeredToName}` }
        : { label: "Offered to you", detail: `Accept within ${state.offerWindowLabel}` };

    case "accepted_relay":
      return isPoster
        ? { label: "Share details", detail: `Give your patient ${state.accepterName}'s number` }
        : { label: "Accepted", detail: "Your details have been shared" };

    case "awaiting_poster_confirmation":
      return isPoster
        ? { label: "Did they connect?", detail: "Yes / didn't work out" }
        : { label: "Accepted", detail: "Awaiting confirmation" };

    case "accepted_direct_dormant":
      return isPoster
        ? { label: "Accepted", detail: `${state.accepterName} is calling the patient` }
        : { label: "Call the patient", detail: `within ${state.contactWindowLabel}` };

    case "completed":
      return { label: "Done", detail: "" };

    case "rerouted_lost_race":
      return isPoster
        ? { label: "Rerouted", detail: `Now with ${state.wonByName}` }
        : {
            label: `${state.wonByName} accepted this one first`,
            detail: `you were one of 2 chosen out of ${state.interestedCount} interested`,
          };

    case "missed":
      return isPoster
        ? { label: "No answer", detail: `${state.offeredToName} didn't respond in time` }
        : { label: "Offer expired", detail: "you can still express interest if it's reposted" };

    case "declined":
      return isPoster
        ? { label: "Declined", detail: `${state.declinedByName} can't take this one` }
        : { label: "Declined", detail: "you told them you can't take this one" };

    case "expired":
      // §8D's table has no receiving-therapist wording for 'expired' — an
      // expired referral notified nobody worth telling twice.
      return isPoster ? { label: "Closed", detail: "No responses" } : null;
  }
}
