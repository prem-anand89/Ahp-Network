"use client";

// [G1] — the ONE live countdown in the whole referral board, shown only
// to the receiving therapist for the offer they were actually sent (see
// referral-display.ts). Rewrite of offer-countdown.tsx per the design
// plan: a ring instead of a bare mm:ss span, second resolution once
// under 5 minutes (a bare "0m" for the last 4 minutes looks frozen), and
// suppressHydrationWarning instead of the old two-pass placeholder
// trick — this renders the real, server-computed remaining time on first
// paint (no "…" flash) and lets the client's own clock silently correct
// it within the first tick, which is exactly the pattern React's own
// docs recommend for a live clock display.

import { useEffect, useRef, useState } from "react";
import { formatRemainingDuration } from "@/lib/referral-labels";

const FINE_RESOLUTION_THRESHOLD_MS = 5 * 60_000;

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "0:00";
  if (ms < FINE_RESOLUTION_THRESHOLD_MS) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  return formatRemainingDuration(ms);
}

export interface CountdownProps {
  /** Server-passed ISO timestamp — home_case_referrals.offer_expires_at. */
  expiresAt: string;
  /** The offer window's full duration, for the ring's fraction-remaining
   * sweep. Not derived from expiresAt alone — the window's start isn't
   * separately stored, so the caller (which already knows urgency, and
   * therefore the 30min/1h window per the 0036 fix) passes it directly. */
  totalMs: number;
  /** Fires once, client-side only, the first time remaining time hits
   * zero — the caller's hook to router.refresh() so a stale "Offered to
   * you" doesn't linger past the window closing. */
  onExpire?: () => void;
}

export function Countdown({ expiresAt, totalMs, onExpire }: CountdownProps) {
  const target = new Date(expiresAt).getTime();
  const [remaining, setRemaining] = useState(() => target - Date.now());
  const hasFiredExpireRef = useRef(false);

  useEffect(() => {
    const tick = () => setRemaining(target - Date.now());
    tick(); // corrects the SSR-vs-client clock gap immediately, not after the first full second
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [target]);

  useEffect(() => {
    if (remaining <= 0 && !hasFiredExpireRef.current) {
      hasFiredExpireRef.current = true;
      onExpire?.();
    }
  }, [remaining, onExpire]);

  const clamped = Math.max(0, remaining);
  const fraction = totalMs > 0 ? Math.max(0, Math.min(1, clamped / totalMs)) : 0;
  const radius = 16;
  const circumference = 2 * Math.PI * radius;

  return (
    <span className="inline-flex items-center gap-2" suppressHydrationWarning>
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden className="shrink-0 -rotate-90">
        <circle cx="18" cy="18" r={radius} fill="none" strokeWidth="3.5" className="stroke-brick-bg" />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          className="stroke-brick transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <span className="font-mono text-sm font-semibold text-brick" suppressHydrationWarning>
        {formatCountdown(clamped)}
      </span>
    </span>
  );
}
