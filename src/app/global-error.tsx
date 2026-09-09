"use client";

// Root-level error boundary — catches anything that escapes every other
// error.tsx (including app/app/error.tsx) so it still gets reported to
// Sentry instead of silently becoming a dead client-side crash. Next.js
// only ever renders this in place of the root layout, so it renders its
// own <html>/<body>.

import { useEffect } from "react";
import * as Sentry from "@sentry/browser";

export default function GlobalError({
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
    <html lang="en">
      <body>
        <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1.5rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#6b7280" }}>
            This page could not be loaded. Try again, or reload if the problem continues.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: "1rem", fontSize: "0.875rem", fontWeight: 500, textDecoration: "underline" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
