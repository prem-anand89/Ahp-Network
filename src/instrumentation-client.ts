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
});
