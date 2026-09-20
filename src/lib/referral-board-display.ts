// §8D — the referral board's own state-line logic, extracted from
// src/app/app/referrals/page.tsx so it's directly testable without
// pulling in that page's getDb()/getVerifiedUserId() imports (same
// DI-testable-pure-function convention as referral-display.ts itself,
// directory.ts, and profile-completeness.ts).

import { displayFor, type ReferralDisplayState } from "./referral-display";
import { formatRemainingDuration } from "./referral-labels";

/** The receiving-therapist mirror of posterDisplayState: myInterestStatus
 * is referral_interest.status, a separate enum from
 * home_case_referrals.status. 'not_selected'/'withdrawn' have no
 * ReferralDisplayState row at all — the detail page shows those in full.
 * Where a real displayFor row exists, reuse it so the copy stays
 * single-sourced and snapshot-tested.
 *
 * Bug fix (Phase 4): 'shortlisted' used to hardcode a static "Open to
 * respond" string, bypassing the real offer-window copy entirely — now
 * passes the referral's actual offerExpiresAt through formatRemainingDuration,
 * the same formatter the live per-second countdown uses. */
export function receivingDisplay(
  myInterestStatus: string,
  offerExpiresAt: Date | null,
): { label: string; detail: string } | null {
  switch (myInterestStatus) {
    case "pending":
      return displayFor({ kind: "interest_no_shortlist", interestedCount: 0 }, "receiving_therapist");
    case "shortlisted":
      return displayFor(
        {
          kind: "shortlisted",
          offerWindowLabel: offerExpiresAt
            ? formatRemainingDuration(offerExpiresAt.getTime() - Date.now())
            : "the window",
          offeredToName: "", // unused on the receiving_therapist branch
        },
        "receiving_therapist",
      );
    case "accepted":
      return displayFor({ kind: "accepted_relay", accepterName: "" }, "receiving_therapist");
    case "not_selected":
      return { label: "Not selected", detail: "Someone else was chosen" };
    case "withdrawn":
      return { label: "Withdrawn", detail: "You withdrew interest" };
    case "missed":
      return displayFor({ kind: "missed", offeredToName: "" }, "receiving_therapist");
    case "declined":
      return displayFor({ kind: "declined", declinedByName: "" }, "receiving_therapist");
    default:
      return null;
  }
}

/** Bug fix (Phase 4): this used to hardcode interestedCount to 0 and
 * collapse 'shortlisted'/'accepted'/'contact_acknowledged' to
 * open_no_interest, so a poster never saw "N interested — Tap to choose"
 * and a mid-flight referral kept reading "Posted — Waiting for
 * responses" long after it wasn't. shortlistedNames/accepterName come
 * from a batched query in page.tsx (the same pattern as Phase 3's
 * verifiedSinceByUserId). 'cancelled_by_poster' and 'auto_closed' have no
 * row in §8D's display-wording table — mapped to the nearest table row
 * ('expired'/'completed') rather than invented. */
export function posterDisplayState(
  status: string,
  interestedCount: number,
  shortlistedNames: string[],
  accepterName: string | null,
): ReferralDisplayState {
  switch (status) {
    case "open":
      return interestedCount > 0
        ? { kind: "interest_no_shortlist", interestedCount }
        : { kind: "open_no_interest" };
    case "shortlisted":
      return shortlistedNames.length > 0
        ? {
            kind: "shortlisted",
            // Unused here — page.tsx only ever reads the poster branch of
            // displayFor's "shortlisted" case, which doesn't reference
            // offerWindowLabel. The receiving side gets its own real
            // window in receivingDisplay() above.
            offerWindowLabel: "",
            offeredToName: shortlistedNames.join(" and "),
          }
        : { kind: "open_no_interest" };
    case "accepted":
    case "contact_acknowledged":
      return accepterName
        ? { kind: "accepted_relay", accepterName }
        : { kind: "awaiting_poster_confirmation" };
    case "completed":
    case "auto_closed":
      return { kind: "completed" };
    case "cancelled_by_poster":
    case "expired":
      return { kind: "expired" };
    default:
      return { kind: "open_no_interest" };
  }
}
