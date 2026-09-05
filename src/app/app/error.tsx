"use client";

// Recoverable surface for dynamic /app/* pages — without this, a transient
// Hyperdrive hiccup or RSC fetch failure during client nav shows Next's
// generic error overlay and forces a manual reload.

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

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
