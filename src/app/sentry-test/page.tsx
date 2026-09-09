"use client";

// Temporary diagnostic page — not linked from anywhere, exists only to give
// an unambiguous pass/fail signal for whether Sentry.init() (wired in
// src/instrumentation-client.ts) actually reaches sentry.io from this
// deployment. Calls Sentry.captureException() directly rather than relying
// on window.onerror, since errors thrown by typing into the DevTools
// console don't reliably trigger the same global-handler path an error
// from real page code does — that ambiguity is exactly what this sidesteps.
// Delete once Sentry is confirmed working end to end.

import { useState } from "react";
import * as Sentry from "@sentry/browser";

export default function SentryTestPage() {
  const [status, setStatus] = useState<string | null>(null);

  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1.5rem" }}>
      <h1 style={{ fontSize: "1.125rem", fontWeight: 600 }}>Sentry wiring test</h1>
      <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#6b7280" }}>
        DSN configured: {process.env.NEXT_PUBLIC_SENTRY_DSN ? "yes" : "NO — missing at build time"}
      </p>
      <button
        type="button"
        onClick={() => {
          const eventId = Sentry.captureException(new Error("Sentry manual test — click trigger"));
          setStatus(`Sent. Event ID: ${eventId}`);
        }}
        style={{ marginTop: "1rem", padding: "0.5rem 1rem", fontSize: "0.875rem", fontWeight: 500 }}
      >
        Trigger test error
      </button>
      {status && <p style={{ marginTop: "1rem", fontSize: "0.875rem" }}>{status}</p>}
    </main>
  );
}
