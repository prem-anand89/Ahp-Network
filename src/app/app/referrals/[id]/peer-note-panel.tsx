"use client";

// Phase 5 — the peer note prompt on a completed referral. Write-once per
// referral per author, editable within 24h, never a count anywhere it's
// displayed (see peer-notes.ts's header). Shown to whichever party
// (poster or accepter) hasn't written one yet, once the referral has
// actually completed.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { writePeerNote, editPeerNote } from "../actions";
import type { MyPeerNote } from "@/lib/peer-notes";

const MAX_LENGTH = 240;
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function PeerNotePanel({
  referralId,
  referralStatus,
  isPoster,
  isAccepter,
  subjectDisplayName,
  myNote,
}: {
  referralId: string;
  referralStatus: string;
  isPoster: boolean;
  isAccepter: boolean;
  subjectDisplayName: string | null;
  myNote: MyPeerNote | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState(myNote?.body ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (referralStatus !== "completed" || (!isPoster && !isAccepter)) return null;

  const withinEditWindow = myNote ? Date.now() - myNote.createdAt.getTime() < EDIT_WINDOW_MS : false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (myNote) {
        await editPeerNote(myNote.id, body);
      } else {
        await writePeerNote(referralId, body);
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (myNote && myNote.status === "visible" && !editing) {
    return (
      <div className="rounded-lg border p-4">
        <p className="text-sm font-semibold">Your peer note</p>
        <p className="mt-1 text-sm text-card-foreground">{myNote.body}</p>
        {withinEditWindow && (
          <Button variant="outline" size="sm" className="mt-2" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>
    );
  }

  if (myNote && myNote.status !== "visible" && !editing) {
    return null;
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border p-4">
      <p className="text-sm font-semibold">
        {subjectDisplayName ? `Write a peer note about ${subjectDisplayName}` : "Write a peer note"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        A short note about working together on this referral — shown on their profile, attributed to you.
      </p>
      <Textarea
        rows={3}
        maxLength={MAX_LENGTH}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="e.g. Clear handoff, easy to reach, patient was well looked after"
        className="mt-2"
        required
      />
      <p className="mt-1 text-right text-xs text-muted-foreground">{body.length}/{MAX_LENGTH}</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Button type="submit" size="sm" loading={submitting}>
          {myNote ? "Save" : "Post note"}
        </Button>
        {editing && (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
