"use client";

// Recoverable surface for dynamic /app/* pages — without this, a transient
// Hyperdrive hiccup or RSC fetch failure during client nav shows Next's
// generic error overlay and forces a manual reload.

import { useEffect } from "react";
import * as Sentry from "@sentry/browser";

// React's Flight/RSC client throws this exact message when a stream gets
// superseded by a newer client-side navigation mid-flight — confirmed via
// Sentry breadcrumbs to follow a request that had already succeeded with
// a 200, not a real data/server failure. Next.js's App Router can hit
// this under fast repeated navigation between/within /app/* routes; since
// the underlying data was fine, one silent retry recovers cleanly instead
// of showing a full-page crash for what's really a benign timing
// artifact. If it recurs right after that retry, something is actually
// wrong, so fall back to the visible error state rather than looping.
//
// The retry-guard lives in sessionStorage, not React state: this project's
// lint config (react-hooks/set-state-in-effect) bans calling setState
// synchronously inside an effect, and a ref can't be read during render
// either (react-hooks/refs) — sessionStorage is a plain imperative browser
// API, subject to neither restriction, and naturally resets itself once
// the tab is closed.
//
// Two-stage escalation, not just one retry: a soft reset() re-renders the
// boundary's children on the client without a network round trip, so if
// the same stale connection object caused the error, reset() alone can
// hand it right back and fail again immediately. A second occurrence of
// the same message therefore escalates to a hard document reload — a real
// new network request, which is the one thing confirmed (via Sentry
// breadcrumbs) to always recover, since it can't reuse anything the
// server holds. Only give up to the static error page on a third
// occurrence, so a genuinely broken page still surfaces to the user
// instead of reload-looping forever.
const AUTO_RECOVERABLE_MESSAGES = ["Connection closed."];
const RETRY_STAGE_KEY = "ahp_app_error_auto_retry_stage";

type RetryStage = "soft" | "hard";

function readStage(message: string): RetryStage | undefined {
  const raw = sessionStorage.getItem(RETRY_STAGE_KEY);
  if (!raw) return undefined;
  const [storedMessage, stage] = raw.split("|");
  return storedMessage === message && (stage === "soft" || stage === "hard") ? stage : undefined;
}

function writeStage(message: string, stage: RetryStage): void {
  sessionStorage.setItem(RETRY_STAGE_KEY, `${message}|${stage}`);
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isKnownRecoverable = AUTO_RECOVERABLE_MESSAGES.includes(error.message);
  const stage = typeof window !== "undefined" && isKnownRecoverable ? readStage(error.message) : undefined;
  const recoverable = isKnownRecoverable && stage !== "hard";

  useEffect(() => {
    Sentry.captureException(error);

    if (!recoverable) {
      sessionStorage.removeItem(RETRY_STAGE_KEY);
      return;
    }

    if (stage === "soft") {
      writeStage(error.message, "hard");
      window.location.reload();
    } else {
      writeStage(error.message, "soft");
      reset();
    }
  }, [error, reset, recoverable, stage]);

  if (recoverable) return null;

  return (
    <main className="mx-auto max-w-lg px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This page could not be loaded. Try again, or reload if the problem continues.
      </p>
      <button type="button" onClick={reset} className="mt-4 text-sm font-medium underline">
        Try again
      </button>
    </main>
  );
}
