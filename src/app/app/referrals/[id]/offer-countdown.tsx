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
  const [remaining, setRemaining] = useState(() => target - Date.now());

  useEffect(() => {
    const interval = setInterval(() => setRemaining(target - Date.now()), 1000);
    return () => clearInterval(interval);
  }, [target]);

  return (
    <span className="font-mono text-sm font-semibold text-[color:var(--destructive)]">
      {formatRemaining(remaining)}
    </span>
  );
}
