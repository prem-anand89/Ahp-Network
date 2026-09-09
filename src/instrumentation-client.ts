// Client-side Sentry init, Next.js's own instrumentation-client.ts
// convention (auto-loaded before hydration, no manual import needed).
// @sentry/browser deliberately, not @sentry/nextjs: the latter pulls in
// @opentelemetry/api, which OpenNext's Cloudflare build can't bundle for
// the Node.js-middleware target (its vendored node_modules copy is
// missing that package's ESM subtree — a build-breaking failure, not a
// runtime one). @sentry/browser has no such dependency and does exactly
// what's needed here: capture the browser-side errors this was added for.
import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  sampleRate: 1.0,
  // False by default, but explicit here rather than relied on — this app
  // handles patient contact info and referral summaries (CLAUDE.md's
  // audit_logs / patient_summary rules), and Sentry's opt-in PII capture
  // (IP address, cookies) is exactly what that posture exists to avoid
  // leaking to a third party. No console.* calls exist client-side to
  // worry about separately (the one that did, in app/app/error.tsx, now
  // reports via Sentry.captureException instead).
  sendDefaultPii: false,
});
