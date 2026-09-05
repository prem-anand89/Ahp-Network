# Cost-trigger alerts runbook (Phase 12)

Plan §7 names five things to watch before real pilot traffic starts. Two are
SQL-queryable and already wired up as automated checks in this repo
(`.github/workflows/cost-check.yml` → `/api/cron/cost-check` →
`src/lib/cost-checks.ts`). The other three are Cloudflare/GCP billing-side
metrics with no equivalent Postgres query — they need to be configured once,
by hand, in each provider's dashboard. This is that one-time setup.

## Already automated (nothing to do here)

- **Supabase connection utilization sustained above ~70%** — hourly check,
  alerts via a failed GitHub Actions run (same "GitHub email on failure"
  channel every other cron workflow in this repo already relies on).

## Needs manual dashboard setup

### 1. Cloudflare Hyperdrive — daily query count approaching 100,000

Hyperdrive's free allowance is 100,000 database queries/day — "the more
realistic thing to watch," per CLAUDE.md, since nearly every request
triggers at least one query.

**Setup:** Cloudflare dashboard → Workers & Pages → Hyperdrive → the
`ahp-network` Hyperdrive config → **Metrics**. Cloudflare's dashboard alerting
(Notifications → Create → **Hyperdrive query volume**, if/when that alert
type is available for your account tier) can page at a chosen threshold —
if that specific alert type isn't yet offered, check this graph manually
at least weekly until it is, and set the threshold at **80,000 queries/day**
(80% of the free allowance) so there's runway to react before hitting the cap.

### 2. Cloudflare R2 — storage approaching a paid tier

**Setup:** Cloudflare dashboard → R2 → **Usage**. Set a billing alert
(Cloudflare dashboard → Notifications → Create → **Billing** category, or
R2's own usage alert if available) at **8 GB** combined across
`ahp-network-credentials` and `ahp-network-photos` (R2's free tier is
10 GB-months of storage) — enough runway to react before storage costs
start.

### 3. Google Cloud Vision (OCR) — spend and call volume

The credential-verification pipeline calls Vision's
`DOCUMENT_TEXT_DETECTION` on every upload (§8A2). Vision's free tier is
1,000 units/month.

**Setup:** Google Cloud Console → Billing → **Budgets & alerts** → Create
budget, scoped to the project used for Vision — set thresholds at 50%/90%/100%
of whatever monthly cap you're comfortable with once past the free tier.
Separately, Cloud Console → APIs & Services → Vision API → **Quotas** shows
call volume directly, useful for sanity-checking the credential-queue's
actual OCR call rate against what the admin queue shows as pending.

### 4. Google Places — API spend

`practices.google_place_id` dedup (§6/§8C) calls the Places API on every new
practice creation attempt.

**Setup:** same Cloud Console project as #3, same **Budgets & alerts** flow,
scoped to the Places API specifically if it's billed under a separate
project/API key than Vision. Google's Places API has no meaningful free
tier for the pilot's expected call pattern, so this one is worth alerting
on from day one rather than waiting for a "getting close" threshold.

---

**Why these two live in dashboards and not in this repo:** none of Hyperdrive's
query count, R2's storage bytes, or either Google API's spend is a number
Postgres can report — they're metered on Cloudflare's and Google's own
billing infrastructure, visible only through each provider's own
usage/billing APIs or dashboard. Building a custom poller against those
APIs would be real engineering effort spent duplicating alerting Cloudflare
and Google already provide natively — the same cost-minimalism reasoning
CLAUDE.md already applies to OCR vendor choice and hosting.
