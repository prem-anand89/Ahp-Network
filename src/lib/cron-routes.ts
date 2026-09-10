// The single mapping from a Cloudflare Cron Trigger to the route it runs.
//
// Why these run on Cloudflare Cron Triggers and not GitHub Actions: GitHub
// does not guarantee scheduled workflows and throttles high-frequency ones
// heavily. Measured on this repo, a `*/5 * * * *` workflow actually fired
// roughly every 2-4 hours, which left the outbox worker's and the
// scheduler's heartbeats over an hour stale — i.e. urgent-referral
// notifications and offer lapsing were running at a cadence the plan
// explicitly forbids ("Deadline/timeout jobs run on a real sub-hourly
// cadence", CLAUDE.md / §8D). Cron Triggers run in the Worker itself and
// fire on time.
//
// The keys must match `triggers.crons` in wrangler.jsonc character for
// character — Cloudflare passes the configured expression through as
// `controller.cron` and this looks it up by exact string, so a stray space
// or a re-worded schedule silently stops a job rather than failing loudly.
// `scripts/check-cron-triggers-wired.mjs` enforces both directions of that
// in CI, so the two files cannot drift.
//
// The liveness check is deliberately NOT here: it is the external monitor
// that alerts when these jobs die, and a monitor running inside the thing
// it monitors cannot report that thing being down. It stays on GitHub
// Actions, where a failed run notifies the repo owner.

export const CRON_ROUTES: Record<string, string> = {
  "*/2 * * * *": "/api/cron/notification-worker",
  "*/15 * * * *": "/api/cron/referral-scheduler",
  "0 * * * *": "/api/cron/cost-check",
  "0 3 * * *": "/api/cron/retention",
  "0 4 * * 1": "/api/cron/weekly-digest",
};

export function cronRouteFor(cron: string): string | undefined {
  return CRON_ROUTES[cron];
}
