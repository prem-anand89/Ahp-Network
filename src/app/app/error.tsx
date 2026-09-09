"use client";

// Recoverable surface for dynamic /app/* pages. Soft-nav RSC fetches that
// abort mid-stream throw React #412 ("Connection closed") during render —
// Next does not fall back to a document load for that case, so the user
// is stuck until a full reload. Detect that and reload once.

import { useEffect } from "react";

const STREAM_CLOSE = /connection closed|#412/i;
const RELOAD_FLAG = "ahp-rsc-stream-reload";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    const text = `${error.message ?? ""} ${error.digest ?? ""}`;
    if (!STREAM_CLOSE.test(text)) return;
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(RELOAD_FLAG) === window.location.pathname) return;
    sessionStorage.setItem(RELOAD_FLAG, window.location.pathname);
    window.location.reload();
  }, [error]);

  return (
    <main className="mx-auto max-w-lg px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This page could not be loaded. Try again, or reload if the problem continues.
      </p>
      <button
        type="button"
        onClick={() => {
          sessionStorage.removeItem(RELOAD_FLAG);
          reset();
        }}
        className="mt-4 text-sm font-medium underline"
      >
        Try again
      </button>
    </main>
  );
}
