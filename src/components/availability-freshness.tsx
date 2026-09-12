"use client";

// Time-dependent display for availability freshness. The timeAgoLabel function
// uses Date.now() and would cause a hydration mismatch if called during server
// render — the server computes one value at render time, and the browser
// hydrates milliseconds later with a different value. Isolate this into a
// client component to prevent React error #441.

import { timeAgoLabel } from "@/lib/referral-labels";

export function AvailabilityFreshness({ updatedAt, isAccepting }: { updatedAt: Date; isAccepting: boolean }) {
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {isAccepting ? "Available for new patients" : "Not accepting new patients right now"}
      {" — updated "}
      {timeAgoLabel(updatedAt)}
    </p>
  );
}
