"use client";

// [G1] — the ONE live countdown in the whole referral board, shown only
// to the receiving therapist for the offer they were actually sent. The
// poster never sees a countdown for anything (see referral-display.ts).

import { useEffect, useState } from "react";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function OfferCountdown({ expiresAt }: { expiresAt: string }) {
  const target = new Date(expiresAt).getTime();
  // Starting from `null` (never `Date.now() - target`) matters: this
  // component's very first render happens on the server, and hydration
  // re-runs that same render on the client. `Date.now()` differs between
  // the two clocks, so an initializer that reads it produces mismatched
  // text and throws React's hydration-mismatch error (#412/#418 family).
  // Rendering a fixed placeholder on both passes, then filling in the real
  // value from an effect (which only ever runs client-side, post-hydration)
  // keeps the two initial renders identical.
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    setRemaining(target - Date.now());
    const interval = setInterval(() => setRemaining(target - Date.now()), 1000);
    return () => clearInterval(interval);
  }, [target]);

  return (
    <span className="font-mono text-sm font-semibold text-[color:var(--destructive)]">
      {remaining === null ? "…" : formatRemaining(remaining)}
    </span>
  );
}
