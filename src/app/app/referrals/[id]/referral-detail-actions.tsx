"use client";

// §8D — the poster's shortlist controls and the receiving therapist's
// accept/decline controls. [G4]: the shortlist screen states the rules
// (up to 2, first to accept wins, how long the offer stays open) BEFORE
// the tap, not after — a one-way action with a window must not be
// discovered by taking it. Round 2: 2h urgent / 12 waking hours routine,
// extendable once, and a missed therapist can be offered again.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CandidateCard } from "@/components/cards/candidate-card";
import { Countdown } from "@/components/ui-ahp/countdown";
import { acceptOffer, declineOffer, expressInterest, extendOffer, sendNudge, shortlistCandidates } from "../actions";
import { OFFER_WINDOW_COPY } from "@/lib/copy";

const HANDOVER_REACHED_STATUSES = ["accepted", "completed", "auto_closed"];

/** §5 — the poster's one canned nudge, no free text, no reply. Rendered
 * only once the referral has actually reached handover. */
function NudgeButton({ referralId }: { referralId: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send() {
    setPending(true);
    setMessage(null);
    try {
      const result = await sendNudge(referralId);
      setMessage(
        result.sent
          ? "Sent — “Any update on this patient?”"
          : "You've already sent a nudge in the last 14 days.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <Button variant="outline" size="sm" disabled={pending} onClick={send}>
        {pending ? "Sending…" : "Send a nudge — “Any update on this patient?”"}
      </Button>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}

export interface InterestedTherapist {
  interestId: string;
  therapistUserId: string;
  displayName: string | null;
  status: string;
  shortlistedAt: string | null;
  slug: string | null;
  photoUrl: string | null;
  specializations: string[];
  verificationStage: "unverified" | "qualification_confirmed" | "credentials_verified";
  localityLabel: string | null;
}

interface Props {
  referralId: string;
  isPoster: boolean;
  referralStatus: string;
  urgency: "routine" | "urgent";
  /** Poster only — empty for every other viewer (see page.tsx). */
  interested: InterestedTherapist[];
  /** The viewer's own interest row, if they're in the matched pool. */
  myInterest: InterestedTherapist | null;
  offerExpiresAt: string | null;
  extendedOnce: boolean;
}

/** IST explicitly: the offer window itself is defined in Asia/Kolkata
 * (add_waking_time), so the time shown must be too, whatever zone the
 * viewer's device or the server happens to run in. */
function formatOfferTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** One row per therapist: a therapist can hold both a 'missed' row and a
 * newer 'pending' one, and shortlist_referral picks the pending row in
 * that case — so does this list. */
function eligibleCandidates(interested: InterestedTherapist[]): InterestedTherapist[] {
  const byTherapist = new Map<string, InterestedTherapist>();
  for (const row of interested) {
    if (row.status !== "pending" && row.status !== "missed") continue;
    const existing = byTherapist.get(row.therapistUserId);
    if (!existing || (existing.status === "missed" && row.status === "pending")) {
      byTherapist.set(row.therapistUserId, row);
    }
  }
  return [...byTherapist.values()];
}

function CandidatePicker({
  referralId,
  candidates,
  slotsLeft,
  heading,
  rules,
}: {
  referralId: string;
  candidates: InterestedTherapist[];
  slotsLeft: number;
  heading: string;
  rules: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setError(null);
    setPending(true);
    try {
      await shortlistCandidates(referralId, selected);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{heading}</h3>
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          {selected.length} of {slotsLeft} chosen
        </span>
      </div>
      {/* [G4] — rules stated before the tap, not after. */}
      <p className="mt-1 text-xs text-muted-foreground">{rules}</p>
      <div className="mt-3 flex flex-col gap-2">
        {candidates.map((t) => {
          const isSelected = selected.includes(t.therapistUserId);
          // A disabled-with-explanation control, not a silent no-op: a tap
          // past the cap that does nothing visible reads as a bug.
          const atCapAndUnselected = !isSelected && selected.length >= slotsLeft;
          return (
            <div key={t.interestId}>
              <CandidateCard
                slug={t.slug}
                displayName={t.displayName}
                photoUrl={t.photoUrl}
                specializations={t.specializations}
                verificationStage={t.verificationStage}
                localityLabel={t.localityLabel}
                selected={isSelected}
                disabled={atCapAndUnselected}
                onToggle={() => {
                  if (isSelected) {
                    setSelected(selected.filter((id) => id !== t.therapistUserId));
                  } else if (selected.length < slotsLeft) {
                    setSelected([...selected, t.therapistUserId]);
                  }
                }}
              />
              {t.status === "missed" && (
                <p className="mt-1 text-xs text-muted-foreground">{OFFER_WINDOW_COPY.missedCandidateNote}</p>
              )}
              {atCapAndUnselected && (
                <p className="mt-1 text-xs text-muted-foreground">
                  You&apos;ve already chosen {slotsLeft} — remove one to pick this therapist instead.
                </p>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <Button className="mt-3" disabled={selected.length === 0 || pending} onClick={submit}>
        {pending ? "Sending…" : `Offer to ${selected.length || ""} therapist${selected.length === 1 ? "" : "s"}`}
      </Button>
    </div>
  );
}

export function ReferralDetailActions({
  referralId,
  isPoster,
  referralStatus,
  urgency,
  interested,
  myInterest,
  offerExpiresAt,
  extendedOnce,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // One key per offer, not per click — CLAUDE.md requires idempotency keys
  // specifically to guard a double-tap on a flaky connection: if the first
  // Accept actually succeeded server-side but the response never arrived,
  // a second tap must reuse the SAME key so acceptOfferTx's idempotency
  // lookup finds it and returns the original success, rather than a fresh
  // random key missing the lookup and racing into "someone else already
  // won." Recomputed only when a genuinely new offer appears.
  // Deliberately unused inside the factory below; this dependency exists
  // purely to invalidate the cached key when a new offer replaces the old
  // one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const acceptIdempotencyKey = useMemo(() => crypto.randomUUID(), [myInterest?.interestId, myInterest?.shortlistedAt]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setPending(true);
    try {
      await action();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (isPoster) {
    if (HANDOVER_REACHED_STATUSES.includes(referralStatus)) {
      return <NudgeButton referralId={referralId} />;
    }

    const candidates = eligibleCandidates(interested);

    if (referralStatus === "open") {
      if (candidates.length === 0) return null;
      return (
        <CandidatePicker
          referralId={referralId}
          candidates={candidates}
          slotsLeft={2}
          heading="Choose up to 2 to offer this to"
          rules={OFFER_WINDOW_COPY.rulesBeforeTap(urgency)}
        />
      );
    }

    if (referralStatus !== "shortlisted") return null;

    // [G1] — the poster gets a plain "open until" time, never a countdown.
    const shortlistedNames = interested
      .filter((i) => i.status === "shortlisted")
      .map((i) => i.displayName ?? "a therapist");
    const slotsLeft = 2 - shortlistedNames.length;

    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border p-4">
          <p className="text-sm">
            {OFFER_WINDOW_COPY.offeredTo(shortlistedNames)}{" "}
            {offerExpiresAt && (
              <span suppressHydrationWarning>{OFFER_WINDOW_COPY.openUntil(formatOfferTime(offerExpiresAt))}</span>
            )}
          </p>
          {urgency === "routine" && (
            <p className="mt-1 text-xs text-muted-foreground">{OFFER_WINDOW_COPY.overnightPauseNote}</p>
          )}
          {extendedOnce ? (
            <p className="mt-3 text-xs text-muted-foreground">{OFFER_WINDOW_COPY.extendedNote}</p>
          ) : (
            <Button
              className="mt-3"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => run(() => extendOffer(referralId))}
            >
              {OFFER_WINDOW_COPY.extendButton(urgency)}
            </Button>
          )}
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
        {/* A decline can leave one slot free mid-round (decline_offer
            reopens the referral only when nobody is left). */}
        {slotsLeft > 0 && candidates.length > 0 && (
          <CandidatePicker
            referralId={referralId}
            candidates={candidates}
            slotsLeft={slotsLeft}
            heading={OFFER_WINDOW_COPY.addAnotherHeading}
            rules={OFFER_WINDOW_COPY.rulesBeforeTap(urgency)}
          />
        )}
      </div>
    );
  }

  // Receiving-therapist view.
  if (!myInterest) {
    return (
      <Button disabled={pending} onClick={() => run(() => expressInterest(referralId))}>
        I&apos;m interested
      </Button>
    );
  }

  if (myInterest.status === "pending") {
    return <p className="text-sm text-muted-foreground">Interest sent — awaiting the poster&apos;s choice.</p>;
  }

  if (myInterest.status === "shortlisted") {
    // The ring's full sweep is this offer's real wall-clock span (which,
    // for routine, includes any overnight pause, and grows if the poster
    // extends) — no longer a hardcoded 30min/1h.
    const totalMs =
      offerExpiresAt && myInterest.shortlistedAt
        ? new Date(offerExpiresAt).getTime() - new Date(myInterest.shortlistedAt).getTime()
        : 0;
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Offered to you</span>
          {offerExpiresAt && (
            <Countdown expiresAt={offerExpiresAt} totalMs={totalMs} onExpire={() => router.refresh()} />
          )}
        </div>
        {urgency === "routine" && (
          <p className="text-xs text-muted-foreground">{OFFER_WINDOW_COPY.overnightPauseNote}</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button
            disabled={pending}
            onClick={() =>
              run(() => acceptOffer(referralId, myInterest.interestId, acceptIdempotencyKey))
            }
          >
            Accept
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => run(() => declineOffer(referralId, myInterest.interestId))}
          >
            Can&apos;t take this one
          </Button>
        </div>
      </div>
    );
  }

  if (myInterest.status === "accepted") {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={`/app/referrals/${referralId}/outcome`} prefetch={false}>
          Report an update
        </Link>
      </Button>
    );
  }

  return null;
}
