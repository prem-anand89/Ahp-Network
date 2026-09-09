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
const AUTO_RECOVERABLE_MESSAGES = ["Connection closed."];
const RETRY_MARKER_KEY = "ahp_app_error_auto_retry";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const alreadyRetried =
    typeof window !== "undefined" && sessionStorage.getItem(RETRY_MARKER_KEY) === error.message;
  const recoverable = AUTO_RECOVERABLE_MESSAGES.includes(error.message) && !alreadyRetried;

  useEffect(() => {
    Sentry.captureException(error);

    if (recoverable) {
      sessionStorage.setItem(RETRY_MARKER_KEY, error.message);
      reset();
    } else {
      sessionStorage.removeItem(RETRY_MARKER_KEY);
    }
  }, [error, reset, recoverable]);

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
