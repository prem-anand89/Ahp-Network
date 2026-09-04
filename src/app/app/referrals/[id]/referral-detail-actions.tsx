"use client";

// §8D — the poster's shortlist controls and the receiving therapist's
// accept/decline controls. [G4]: the shortlist screen states the rules
// (up to 2, first to accept wins, 30min/1h cooling-off hold) BEFORE the
// tap, not after — a one-way action with a cooling-off period must not be
// discovered by taking it.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { OfferCountdown } from "./offer-countdown";
import { acceptOffer, declineOffer, expressInterest, shortlistCandidates } from "../actions";

export interface InterestedTherapist {
  interestId: string;
  therapistUserId: string;
  displayName: string | null;
  status: string;
}

interface Props {
  referralId: string;
  isPoster: boolean;
  referralStatus: string;
  urgency: "routine" | "urgent";
  interested: InterestedTherapist[];
  /** The viewer's own interest row, if they're in the matched pool. */
  myInterest: InterestedTherapist | null;
  offerExpiresAt: string | null;
}

export function ReferralDetailActions({
  referralId,
  isPoster,
  referralStatus,
  urgency,
  interested,
  myInterest,
  offerExpiresAt,
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const holdLabel = urgency === "urgent" ? "30 minutes" : "1 hour";

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
    if (referralStatus !== "open") return null; // already shortlisted/accepted — nothing to pick

    const pendingInterest = interested.filter((i) => i.status === "pending");
    if (pendingInterest.length === 0) return null;

    return (
      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Choose up to 2 to offer this to</h3>
        {/* [G4] — rules stated before the tap, not after. */}
        <p className="mt-1 text-xs text-muted-foreground">
          Whoever accepts first gets the case. Once sent, your choice can&apos;t be changed for{" "}
          {holdLabel}.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {pendingInterest.map((t) => (
            <label key={t.interestId} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(t.therapistUserId)}
                onChange={(e) => {
                  if (e.target.checked) {
                    if (selected.length >= 2) return;
                    setSelected([...selected, t.therapistUserId]);
                  } else {
                    setSelected(selected.filter((id) => id !== t.therapistUserId));
                  }
                }}
              />
              {t.displayName ?? "Therapist"}
            </label>
          ))}
        </div>
        {error && <p className="mt-2 text-sm text-[color:var(--destructive)]">{error}</p>}
        <Button
          className="mt-3"
          disabled={selected.length === 0 || pending}
          onClick={() => run(() => shortlistCandidates(referralId, selected))}
        >
          {pending ? "Sending…" : `Offer to ${selected.length || ""} therapist${selected.length === 1 ? "" : "s"}`}
        </Button>
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
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Offered to you</span>
          {offerExpiresAt && <OfferCountdown expiresAt={offerExpiresAt} />}
        </div>
        {error && <p className="text-sm text-[color:var(--destructive)]">{error}</p>}
        <div className="flex gap-2">
          <Button
            disabled={pending}
            onClick={() =>
              run(() => acceptOffer(referralId, myInterest.interestId, crypto.randomUUID()))
            }
          >
            Accept
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => run(() => declineOffer(referralId, myInterest.interestId))}
          >
            Can&apos;t take this one
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
