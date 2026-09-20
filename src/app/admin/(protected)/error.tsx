"use client";

// Phase 1 step 15 — without this, an admin-page throw escalates past this
// segment's layout.tsx (the ADMIN MODE banner + AdminSubNav) all the way
// to global-error.tsx, which renders its own fresh <html> with none of
// that chrome — losing the "unmissable visual distinction" §8G5 requires
// exactly when something has gone wrong and an admin most needs to know
// they're still in the audited context. A same-segment error.tsx renders
// inside the parent layout instead of replacing it, so the banner stays.

import { useEffect } from "react";
import * as Sentry from "@sentry/browser";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-lg px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This admin page could not be loaded. Try again, or go back to the admin home.
      </p>
      <div className="mt-4 flex items-center justify-center gap-4">
        <button type="button" onClick={reset} className="text-sm font-medium underline">
          Try again
        </button>
        <a href="/admin" className="text-sm font-medium underline">
          Admin home
        </a>
      </div>
    </main>
  );
}
