"use client";

// REFERRAL_LOOP_SPEC_ADDENDUM.md §4 — outcome + optional note/reason. The
// note field only renders for outcomes that earn one (mirrors
// reportOutcomeTx's own CHECK-matching validation), and is hidden
// entirely under CONSENT_TEXT_VERSION 1 rather than shown then rejected.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { HANDOVER_NOTE_PLACEHOLDER, HANDOVER_NOTE_WARNING } from "@/lib/copy";
import { DISCONTINUED_REASON_LABELS, REFERRAL_OUTCOME_LABELS } from "@/lib/referral-labels";
import type { DiscontinuedReason, ReferralOutcome } from "@/lib/referral-outcomes";
import { reportOutcome } from "../../actions";

const OUTCOME_ORDER: ReferralOutcome[] = [
  "no_patient_contact",
  "contacted_not_started",
  "first_session_done",
  "ongoing",
  "completed_discharged",
  "not_suitable_referred_on",
  "discontinued",
];

const REASON_ORDER: DiscontinuedReason[] = [
  "switched_therapist",
  "not_responding",
  "cost",
  "travel_distance",
  "improved",
  "mismatch",
  "not_comfortable",
  "medical_reason",
  "relocated",
  "other",
];

// Mirrors referral_status_updates_note_check exactly.
const NOTE_ALLOWED_OUTCOMES = new Set<ReferralOutcome>(["ongoing", "completed_discharged", "not_suitable_referred_on"]);
const NOTE_ALLOWED_REASONS = new Set<DiscontinuedReason>(["medical_reason", "other"]);

export function ReportOutcomeForm({ referralId, noteAllowed }: { referralId: string; noteAllowed: boolean }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<ReferralOutcome | "">("");
  const [reason, setReason] = useState<DiscontinuedReason | "">("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showReason = outcome === "discontinued";
  const noteEarnedByOutcome =
    outcome !== "" &&
    (NOTE_ALLOWED_OUTCOMES.has(outcome) || (outcome === "discontinued" && NOTE_ALLOWED_REASONS.has(reason as DiscontinuedReason)));
  const showNote = noteAllowed && noteEarnedByOutcome;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!outcome) return;
    setError(null);
    setPending(true);
    try {
      await reportOutcome(referralId, {
        outcome,
        discontinuedReason: outcome === "discontinued" ? (reason || undefined) : undefined,
        note: showNote && note.trim() ? note.trim() : undefined,
      });
      router.push(`/app/referrals/${referralId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <fieldset className="flex flex-col gap-1.5">
        <label htmlFor="outcome" className="text-sm font-medium">
          What&apos;s the latest?
        </label>
        <select
          id="outcome"
          required
          value={outcome}
          onChange={(e) => {
            setOutcome(e.target.value as ReferralOutcome);
            setReason("");
          }}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="" disabled>
            Choose an update
          </option>
          {OUTCOME_ORDER.map((key) => (
            <option key={key} value={key}>
              {REFERRAL_OUTCOME_LABELS[key]}
            </option>
          ))}
        </select>
      </fieldset>

      {showReason && (
        <fieldset className="flex flex-col gap-1.5">
          <label htmlFor="reason" className="text-sm font-medium">
            Reason
          </label>
          <select
            id="reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value as DiscontinuedReason)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Choose a reason
            </option>
            {REASON_ORDER.map((key) => (
              <option key={key} value={key}>
                {DISCONTINUED_REASON_LABELS[key]}
              </option>
            ))}
          </select>
          {reason === "medical_reason" && (
            <p className="text-xs text-muted-foreground">Hospitalised, or the condition changed.</p>
          )}
        </fieldset>
      )}

      {showNote && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="note" className="text-sm font-medium">
            Handover note to the referring therapist (optional)
          </label>
          <p className="text-xs font-medium text-[color:var(--destructive)]">{HANDOVER_NOTE_WARNING}</p>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            placeholder={HANDOVER_NOTE_PLACEHOLDER}
            rows={3}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
          <p className="text-right text-xs text-muted-foreground">{note.length}/500</p>
        </div>
      )}

      {error && <p className="text-sm text-[color:var(--destructive)]">{error}</p>}

      <Button type="submit" disabled={!outcome || pending}>
        {pending ? "Sending…" : "Send update"}
      </Button>
    </form>
  );
}
