"use client";

// Phase 5 — peer notes on a profile. At most two, by recency (the read
// path — peer-notes.ts's listPeerNotesForProfile — enforces the cap, so
// this component never has to). Never a count anywhere: no "N notes"
// header, nothing that turns "worked together" into a leaderboard.
// canHide is a page-level fact (is the viewer looking at their own
// profile?), passed down rather than derived per note.

import { useState, useTransition } from "react";
import {
  CredentialsVerifiedBadge,
  QualificationConfirmedBadge,
} from "@/components/badges/verification-badge";
import { hidePeerNote } from "@/app/app/referrals/actions";

export interface PeerNoteForDisplay {
  id: string;
  body: string;
  createdAt: string;
  authorDisplayName: string | null;
  authorVerificationStage: "unverified" | "qualification_confirmed" | "credentials_verified";
}

function attributionDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { year: "numeric", month: "short" });
}

export function PeerNotesSection({
  notes,
  canHide,
}: {
  notes: PeerNoteForDisplay[];
  canHide: boolean;
}) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const visible = notes.filter((n) => !hiddenIds.has(n.id));
  if (visible.length === 0) return null;

  function handleHide(noteId: string) {
    setHiddenIds((prev) => new Set(prev).add(noteId));
    startTransition(async () => {
      try {
        await hidePeerNote(noteId);
      } catch {
        // Silent, one-tap, forgiving of failure the same way circles.ts's
        // adds are — worst case the note reappears on next load and the
        // subject taps hide again.
      }
    });
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">Peer notes</h2>
      <div className="mt-2 flex flex-col gap-3">
        {visible.map((note) => (
          <div key={note.id} className="rounded-card border p-3">
            <p className="text-sm text-card-foreground">{note.body}</p>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {note.authorDisplayName ?? "A therapist"} · Worked together on a referral,{" "}
                {attributionDateLabel(note.createdAt)}
                {note.authorVerificationStage === "credentials_verified" && (
                  <span className="ml-1.5 inline-block align-middle">
                    <CredentialsVerifiedBadge dateLabel="" />
                  </span>
                )}
                {note.authorVerificationStage === "qualification_confirmed" && (
                  <span className="ml-1.5 inline-block align-middle">
                    <QualificationConfirmedBadge dateLabel="" />
                  </span>
                )}
              </p>
              {canHide && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleHide(note.id)}
                  className="shrink-0 text-xs text-muted-foreground hover:underline"
                >
                  Hide
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
