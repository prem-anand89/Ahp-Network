# AHP Network — Consolidated Plan (v19)

**v19 is a correction pass applied in place over v18.** It fixes seven findings that made parts of v18 literally unbuildable, resolves the Hyperdrive transaction question in a way that removes the problem rather than managing it, and records twelve architectural decisions v18 left to be made by accident. It is not a redesign — no product decision, scope boundary, or trust rule from v18 changes. The full review, including the reasoning behind each fix and the open decisions that remain the founder's call, is in `ARCHITECTURE_REVIEW.md`. Corrections are marked **[v19]** at the point of change; the v19 changelog is immediately below §0's v18 entries.

**Supersedes v17.** This revision is a consolidation and correction pass, not a redesign: it cleans up a genuine hosting-architecture contradiction left over from before Cloudflare was chosen, simplifies auth to reduce custom security surface, tightens referral posting and matching so the platform is measurably more targeted than the WhatsApp workflow it's replacing, adds two small features that grow organically off work already being done (institution search, network activity feed), fully specifies Circles and Communities in place of v17's placeholder, and adds explicit density gates for Communities and Recruiting. A summary is at §0.

---

## 0. Changelog from v17

**Prompted by a critical review of a second AI agent's recommendations, worked through item by item rather than accepted wholesale.**

### Kept exactly as-is — recommendations considered and rejected

| Item considered | Verdict | Reason |
|---|---|---|
| Revert the shortlist race to sequential (poster picks one, waits, then picks a backup) | **Rejected.** Unchanged from v17. | This is what v11 did, and v12 replaced it deliberately — sequential selection wastes time even when the poster has already vetted two people. The race is explicitly "the product's reason to exist, not a v1 placeholder" (§8D). Nothing in this review changes that reasoning. |
| `referral_reason` structured field | **Dropped.** Considered, then explicitly removed by founder decision this round. | Adds a required-feeling field with unclear payoff; the optional `additional_context` free-text field (below) covers the same intent without forcing a taxonomy decision this early. |
| Weighted/configurable matching scoring function | **Rejected in favour of a plain filter.** | At 25–30 pilot therapists, a boolean filter (specialty AND area AND accepting_referrals AND visit-type match) is the entire matching system needed. A scoring engine is complexity ahead of the density that would make it meaningful — same logic already applied to rejecting dual-OCR-vendor complexity in v17. |
| Experience-level as a hard matching filter | **Rejected for the pilot.** | Adding another filter axis at this scale risks empty matched pools on specialties that already have thin coverage — same failure mode §14 already gates locality-level matching behind. Captured instead as free text in `additional_context`, shown but never filtering. |
| 12-hour backups (up from nightly) | **Rejected — kept nightly.** | Marginal RPO improvement for a 30-person pilot, doubles cron/R2-write frequency for no proportionate benefit. Revisit at real scale. |

### Adopted — genuine v17 gaps or contradictions this review caught

| Change | Reason |
|---|---|
| **Canonical storage/hosting corrected to Cloudflare R2 + Cloudflare CDN throughout; stale S3/CloudFront/Vercel Analytics references removed** (§7) | v17 §7 decided Cloudflare Pages/Workers over Vercel, but its own infra checklist still referenced S3 presigned uploads and CloudFront — leftover from before that decision, never cleaned up. Not a new architecture decision, a contradiction fix. R2 also has zero egress fees vs. S3+CloudFront — a direct cost win. |
| **Auth mechanism switched to Supabase Auth (native email OTP + Google OAuth), replacing the custom-built magic-link system** (§4) | Removes an entire hand-rolled security surface (custom Argon2 hashing, atomic attempt-counting, code-invalidation races) in favour of a library already covering the exact two methods needed, on a stack already running Supabase Postgres. App-level rules that sit above any auth provider — sensitive-identity-change hold, admin re-authentication, audit logging — are unchanged and still fully specified. |
| **Home-visit / clinic-visit toggles wired into matching** (§8D) | `accepts_home_visits` / `accepts_clinic_visits` already existed on `users` since v7 but nothing in the matching logic read them. A home-visit referral now only notifies therapists who accept home visits, and vice versa — closes a real targeting gap. |
| **`accepting_referrals` toggle added** (§8A) | Separates "I have this skill" from "I want referrals for it right now" — directly reduces irrelevant notifications, which is the single biggest lever on whether TheraNet actually feels better than a WhatsApp group. |
| **Referral posting fields (`role_needed`, `specialization_needed`) made structured, not free text** (§8D) | These existed in v17's schema but were never defined as anything concrete, which means they couldn't reliably drive a matching filter. Scoped to the same three professions and two pilot specialties already defined in §1/§2 — not new scope, just making an existing decision queryable. |
| **`additional_context` free-text field added to referral posting** (§8D) | Optional, shown to the matched pool, never filters who gets notified. Absorbs the intent `referral_reason` would have covered without forcing a taxonomy this early. |
| **Explicit patient-summary UI guardrail: placeholder example + inline warning** (§8D2) | `patient_summary` was free text with nothing stopping a therapist from typing a name or phone number into it — quietly defeating the relay-only privacy design the whole pilot is built around. Placeholder text (*"e.g. 65M, s/p knee replacement, needs regular home PT"*) plus a one-line warning closes this cheaply. |
| **`matching_algorithm_version` column added** (§8D) | Freezes which matching logic produced a given `matched_pool_size_at_post`, so future matching changes don't corrupt historical analytics. |
| **`referral_events` gains `notification_dispatched` and `referral_viewed`** (§8D) | Two more values in the existing `TEXT` event_type field — makes "time to first response" and "time to first view" real queries instead of estimates. |
| **`master_institutions` + `credentials.institution_id`, curated the same way `master_courses_certifications` already is** (§8B2) | Enables search-by-college (e.g. "Manipal," "NIMS") without hand-building a list upfront. OCR already extracts institution names from Tier 1 documents; fuzzy-matched against the master list on submission, unmatched names enter the existing curation queue. Same mechanism, same admin habit, as course taxonomy. |
| **"Network Activity" feed — platform-wide, structured-fields-only view of open referrals, visible to everyone regardless of match** (§9, §10H) | Gives every therapist a reason to open the app on a day nothing personal is happening, and builds visible momentum in a small cohort. Deliberately excludes `patient_summary` free text and any interest/accept action for non-matching therapists — keeps this inside the existing patient-consent wording (§8D2), which was written for the matched-pool audience, not the whole platform. |
| **Dashboard engagement additions: reciprocity stat, weekly digest job** (§10H) | Both reuse data already collected (`referral_interest`, `invites`). No ranking, score, or comparison to others — first-person facts only, consistent with §1A's no-ranking rule and §9's rejection of gamed engagement signals like "last login." Weekly digest is the one genuinely new build item: one scheduled job alongside the ones already planned for nudges and purges. |
| **Communities gated at ≥100 verified active therapists in a city** (§2) | Same density-gating logic already applied to locality-level matching and second-city expansion (§14) — a concrete number instead of "v1.5." Fully specified, not just gated — see §8E3. |
| **Recruiting gated on a two-part trigger, not headcount alone** (§2, §8F) | Headcount alone risks re-creating exactly the empty-board problem §8F already identified: a city can have 100+ verified therapists and zero claimed practices. At ~100 verified therapists, active claim solicitation begins; the vacancy board surface itself ships once ≥5 approved `practice_claims` exist in that city. |
| **P0 / P1 / P2 build boundary added as an explicit table** (§13) | Consolidates the "still genuinely open" engineering items already flagged in v17 §0 into concrete, resolved, one-line decisions rather than leaving them open in the handoff. |
| **Cost triggers restated as "% of currently applicable quota, last verified [date]"** rather than hardcoded figures (§7) | Protects the plan from stale numbers (e.g., Google's credit amount changing) without re-deriving the actual trigger logic, which was already sound. |

### New in this pass — Circles & Communities specified in full (§8E2, §8E3)

v17's Groups & Communities entry was a deliberate stub: *"Group moderation, member removal, moderator permissions, and closure flows are deliberately NOT specified here — writing moderation policy for a deferred feature guarantees it is stale before it ships. Specify at build time."* This is that build-time spec, worked through as a separate design pass and folded in here rather than left as a placeholder. Build itself remains deferred, gated per §2 — nothing here changes the pilot scope.

| Decision | Verdict |
|---|---|
| **Circles** — private, silent, named lists of professionals | Added as a structured version of the already-deferred `bookmarks` feature. 100% silent — no notification, no counter, no visibility to the person added. Future referral-targeting utility specified but explicitly not built until two open decisions (fallback timing, ops-metric exclusion) are made. |
| **Communities, four origin types** | Platform-curated, auto-generated (institution / certification / workplace), and user-created — kept as genuinely distinct models rather than one generic mechanism, since each has a different consent, threshold, and moderation shape. |
| **Auto-enrolment: workplace only** | Institution and certification membership is recommended, one-tap opt-in, never automatic — the underlying fact (where someone studied) was established via document upload, not an act of public disclosure. Workplace is the one exception: `practice_users` affiliation acceptance is already public via §8C3, so a workplace community is a different view of an existing disclosure, not a new one. |
| **Certification communities scoped to internationally recognised bodies only** | A short, admin-curated allow-list (Mulligan, Maitland, McKenzie/MDT, Cyriax, PNF, Bobath/NDT, Barral) rather than every row in `master_courses_certifications` — avoids a long tail of near-empty communities for one-off local workshop certificates. |
| **Moderation: self-nomination + admin approval, not voting or auto-appointed faculty** | Both alternatives considered and rejected — voting is real infrastructure this scale doesn't need and is gameable in a small community; auto-appointing faculty fails consent and has no built verification pipeline. Reuses the same self-nomination-plus-admin-approval shape already used for practice claims. Multiple moderators per community, revocable, scoped narrowly, kept outside `admin_user_roles` entirely. |
| **Posting: three structured types only — Announcement, Resource, Event (P1)** | No reply threads, no open-ended discussion posts. Referrals are never a post type — the community referral view reuses the existing Network Activity feed (§9), filtered, rather than adding a fourth type that would bypass referral consent/access-tier mechanics. |
| **Response signal: a single Like (public count) + private view count** | Considered and rejected: a reaction picker (drifts toward social-media mechanics) and a Save-based signal (more useful but a bigger behavioural ask); landed on the simplest, most familiar option. No dislike, ever — a dislike button in a 25–30 person community where everyone knows everyone is a near-guaranteed friction source. |
| **Institution/certification logos: name auto-matched, logo never auto-scraped** | Auto-pulling a third party's trademarked crest/mark was rejected outright — same "implies official standing" risk already flagged in §1 for the product name, recurring at the institution level. Default is a generated placeholder; a real logo is only ever admin-uploaded, one at a time, after a manual rights check. |

### New in this pass — Directory filters refined against Practo and Psychology Today (§9)

| Decision | Verdict |
|---|---|
| **Filter taxonomy split into a default set (4) and a "more filters" progressive-disclosure set (8)** | Modeled on Psychology Today's UX pattern specifically — a first-time patient visitor gets four decisions, not twenty; a returning searcher or therapist can go deeper. |
| **`gender` added to `users`** | New field. Self-reported, optional, `'prefer_not_to_say'` is a distinct choice from null. Real filter in both comparables, genuinely relevant for home-visit comfort, not a vanity addition. |
| **`age_groups_served` added to `users`** | New field, multi-select (pediatric/adult/geriatric). Kept deliberately separate from `specialization_type` rather than folded into it — different axis (who's treated vs. what's treated), and mixing them would force the specialization enum to grow combinatorially. |
| **`tele_rehab_available` wired into the directory filter set** | No schema change — the field existed on `users` since v7 but §9 never listed it as a filter. Closes a real gap at zero cost. |
| **Ratings/reviews and consultation fee explicitly rejected as filters, not deferred** | Ratings violate §1A outright — this is the one filter Practo leans on hardest and the one deliberately not copied. Fee has no backing data and no scope to build one (§3, §8D2 both keep booking/pricing out of scope). |
| **Bucketed experience ranges, not exact-year filtering** | Cheap to build, avoids a filter granular enough to start reading as a ranking signal. |

### New in this pass — Admin section split into write actions (custom) and monitoring (Metabase) (§8G6)

| Decision | Verdict |
|---|---|
| **Admin surface split into custom-built write actions vs. BI-tool read-only monitoring** *(the split holds; **[v19]** the "self-hosted Metabase, free" half is superseded — see §0a and §8G6: it needs a ~2GB container host, so it is deferred and the pilot runs saved SQL against restricted `analytics` views)* | §12's ops dashboard was previously "a set of saved SQL queries run every Monday" — genuinely low-build but also genuinely manual. A BI tool gets the same queries into real dashboards with no application code. Custom build stays reserved for actions that actually change state, which is where §8G5's role enforcement and audit logging need to live anyway. |
| **Admin navigation scoped by existing `admin_role_type` roles, no new role system** | Verification, practice claims, communities, referral ops, grievance, and feedback each map to a role already defined in §8G5 — nothing new invented, just organized into an actual IA. |
| **Analytics access is a link-out, not a scoped section** | Since Metabase is read-only, it doesn't need the same per-role gating as the write-action sections — any admin can view it. |

### New in this pass — Three decisions surfaced by building the screen mockups

Mockups aren't kept in this document (they're visual reference from the build conversation, not schema-bearing), but three real product decisions came up while building them and are recorded here:

| Decision | Verdict |
|---|---|
| **Circles and Communities do not share a tab** | Initially sketched together in a nav mockup; split — Circles into Profile/settings (private, personal tool), Communities keeps its own tab (public, networking surface). See §8E2. |
| **`age_groups_served` is shown on the profile; `gender` is filter-only** | Neither had a display rule before this — both existed only as search filters. `age_groups_served` is professional scope information, shown as tags (§8C3). `gender` stays filter-only, never rendered on the profile card, since displaying it reads as a personal-identity label rather than a search convenience. See §8A. |
| **Practice profiles never auto-derive a "home visits" indicator from affiliated therapists** | Home-visit capability is a therapist-level fact, not a practice-level one — showing it on a practice card would overclaim. If an owner wants to mention it, that's their own free-text `services_offered` entry, never system-generated. See §8C3. |

### New in this pass — Two-tier verification, pilot engagement, and interim legal bridge

| Decision | Verdict |
|---|---|
| **Two-tier verification: `qualification_confirmed` and `credentials_verified`, replacing the single `verification_status`** | NCAHP enrollment for physiotherapists is early-stage nationally — most currently practicing therapists hold a state council/paramedical board registration, not yet NCAHP. Gating the full badge on NCAHP alone would exclude most physiotherapists during the transition window. A genuine second tier (degree/PG only) fixes this without lowering the actual gate — referral claiming and `patient_summary` access still require the full tier. See §8A1a. |
| **`master_councils`, hand-curated, never OCR-auto-created** | Distinguishes statutory registration (state councils, paramedical boards, NCAHP) from professional association (IAP) — only the former satisfies `credentials_verified`, though either can be displayed. Real, reported fraud around fake "councils" in this space is the specific reason this table stays hand-curated rather than growing organically like `master_institutions`. |
| **Pilot seed: 3 rows only (TGPMB, NCAHP, IAP), not a pre-built national list** | The pilot is single-city. A researched 36-state reference exists as a curation aid for future admin review, not as something pre-seeded and trusted without a check at time of use — regulatory status in this space changes fast enough that a static list can't substitute for verification when a new state is actually needed. |
| **Certificate taxonomy formalized**: Graduation/PG/Council Registration → `credentials` (OCR-gated); Diploma, International Accredited Certifications, Other Workshops → `course_completions` (curated display taxonomy, never OCR'd, never gates verification) | Closes a gap where the certificate types discussed conversationally never had an explicit mapping to which of the two existing schema paths they belonged to. |
| **Founding-cohort Community ships at pilot launch, the one exception to the ≥100 gate** | The gate protects against *auto-generated* communities starting empty at low density — a single founder-created, founder-moderated community for the whole founding cohort has neither risk, and it's the in-app version of what §13 already planned to run manually as a WhatsApp group. Event posts (already minimal — no RSVP/capacity) are allowed for this community specifically, ahead of the general P1 timing for the type. |
| **New-member cards added to the Network Activity feed** | Direct fix for the feed being genuinely empty at 25–30 people and thin early referral volume — no new schema, reads off data already collected. |
| **No incentivized referral/invite reward program — rejected, not deferred** | In a small trusted cohort, a reward-driven invite mechanic reads as suspicious the moment it's noticed, and undermines the intrinsic motivation invite-led cold start was chosen to preserve over seeding in the first place. |
| **Interim Founding Member Declaration and Data & Privacy Notice** | Bridge documents for the pre-registration, pre-counsel period — explicitly non-legal, temporary, plain-language. Not a replacement for §15A items 1–3, which remain required before any wider launch. |

### New in this pass — Hosting decision corrected: Cloudflare Workers confirmed, Hyperdrive moved from P1 to P0

**§7 previously said Hyperdrive was P1, deferred until connection pressure was demonstrated — this was already stale the moment the hosting question was actually worked through, and is corrected here rather than left standing.**

| Decision | Verdict |
|---|---|
| **Cloudflare Workers confirmed for the initial phase**, traditional Node hosting (Railway/Render) and Vercel both evaluated and set aside for now | Workers stays genuinely free through the pilot; Railway/Render realistically cost $5–12/month once truly always-on, Vercel Pro starts higher still. Conscious cost trade-off, not a default. |
| **Hyperdrive is P0, used from day one — not deferred** | Workers cannot hold a traditional long-lived Postgres connection efficiently; Hyperdrive is close to required infrastructure for this pattern, not an optional tuning step. The plan's prior "P1, evaluate if needed" framing was wrong the moment Workers was confirmed as the host. |
| **The Hyperdrive/transaction-mode trade-off is now stated explicitly, not left implicit** | Hyperdrive supports transaction-mode pooling only; Cloudflare's own documentation cautions against leaning on it for long, multi-statement locking transactions — exactly the shape of the referral shortlist/accept transactions in §8D. This is a known, accepted risk, weighed consciously against traditional hosting's small monthly cost, not an oversight. The concurrency invariant tests in §8D are non-negotiable specifically because of this. |
| **Two portability rules added**: R2 via its S3-compatible API not Cloudflare's native bindings; all database connection setup isolated to one file | Costs nothing extra to do correctly now, and is what determines whether a future hosting move (if the Hyperdrive trade-off ever stops being worth it) is a deployment-config change or an application rewrite. |
| **Vercel Hobby ruled out at any point, including as a pre-monetization bridge** | Vercel's own terms define commercial use by whether this is a business project at all, not by revenue status — a pilot run as part of a real business is commercial from day one under their policy. |

### New in this pass — Hyperdrive trade-off actually mitigated, not just documented; OpenNext vs. vinext resolved

**The previous round left the shortlist/accept transaction risk as "worth evaluating at build time, not yet decided." That's no longer accurate — it's decided.**

| Decision | Verdict |
|---|---|
| ~~**Shortlist and accept transactions bypass Hyperdrive entirely, connecting directly to Supabase's Supavisor pooler in session mode**~~ **— SUPERSEDED IN v19, see §0a.** The transactions are now PL/pgSQL functions called as one statement each, which makes the bypass unnecessary rather than merely mitigated. | Removes the one thing Cloudflare's own documentation cautions against, for exactly the two transactions where it matters. Cost: a few hundred ms on two infrequent, deliberate taps, never on a page load. Every other query stays on Hyperdrive. §8D's concurrency invariant tests remain required regardless — this reduces risk, it doesn't replace testing. |
| **OpenNext confirmed over Cloudflare's newer `vinext` adapter** | Checked against current state: `vinext` is explicitly experimental by Cloudflare's own account, majority AI-written with minimal human review, already had security vulnerabilities patched in its first weeks, and doesn't yet support static pre-rendering — relevant to the SEO-driven public directory. Even `vinext`'s own docs recommend OpenNext as the mature choice. Revisit only once it has real production maturity. |
| **Railway/Vercel reframed as a conditional fallback with named triggers, not a scheduled revisit** | Four concrete conditions now stated in §7 (failed concurrency test, real CPU/wall-clock limits hit, blocking Node compatibility gap, cost parity lost) — hosting only gets reconsidered if one of these actually fires, not because the question comes up again. |

### New in this pass — external hosting-risk review, verified against current Cloudflare pricing before accepting anything

**A second AI's review of the hosting decision was checked point by point — some findings held up, one set of numbers didn't survive verification against Cloudflare's own current pricing docs.**

| Decision | Verdict |
|---|---|
| ~~**Fail-closed on the Supavisor bypass**~~ **— SUPERSEDED IN v19, see §0a.** There is no bypass; fail-closed now applies to any referral transaction error. | If the direct session-mode connection fails, the shortlist/accept endpoints fail with a retry prompt — never silently fall back to Hyperdrive, which would reintroduce the exact risk the bypass exists to remove, at the worst possible moment. |
| **Concurrency testing is now an explicit pre-launch hard gate**, and split into two distinct tests | Race-correctness (2-way, matching the actual shortlist cap) and connection-pool load (many concurrent transactions across many referrals) test different things and were previously at risk of being conflated into one under-specified test. |
| **A fifth, deliberately human hosting-fallback trigger added**: sustained disproportionate time spent on Cloudflare-specific debugging | Fills a real gap — the four existing triggers were all technical/measurable; none captured "survivable individually, but eating too much solo-founder time in aggregate." |
| **`wrangler dev` required for critical-path testing, not just `next dev`** | Real, well-known gap: local Node.js and production V8 isolates are different runtimes. Same "works in the wrong environment, fails in the right one" risk already flagged for pooling mode. |
| **Warm-standby Railway deploy test, timing corrected from after Phase 3 to after Phase 6** | Good instinct (test the ripcord before needing it, same discipline already applied to backup restores) — but Phase 3 doesn't yet include the referral engine, the actual thing most likely to ever need migrating. (**[v19]** The bypass logic this row referred to no longer exists; the Railway test itself stands, and gets cheaper — one connection path, and the referral functions travel with the database.) Testing before it exists tests the wrong thing. |
| **The specific cost-trigger numbers proposed ("$5–15/month once you cross 300–500 users," "Hyperdrive = 1 pool") were rejected, not carried forward** | Checked directly against Cloudflare's current pricing docs: Workers Paid is a flat $5/month covering 10M requests + 30M CPU-ms, likely covering this app's traffic far past 1,000–2,000 users. The "1 pool" Hyperdrive claim didn't match current documentation. Replaced with the actual more-realistic watch-metric: Hyperdrive's 100,000-queries/day free allowance, which is likely to bind before raw request count does, given this app's query-per-request pattern. |

### Reframed, not replaced

| Change | Reason |
|---|---|
| **§11's primary pilot question stays "will therapists trust and complete local profiles," with a WhatsApp-displacement/referral-funnel-speed track added as a named secondary lens** | The original reframe in v13/v17 exists specifically *because* relay-only means the platform cannot observe post-acceptance completion — that constraint is unchanged, and a differently-worded primary question doesn't remove it. What genuinely is new and cleanly measurable: pre-acceptance funnel speed (posted → first response → selected) and whether therapists say TheraNet replaced a WhatsApp post. Both added as secondary metrics, not a replacement of the primary framing. |

---

## 0a. Changelog — v19 correction pass

**Prompted by a pre-code architecture and design review, conducted by reading v18 the way an implementer would rather than the way its author does.** Everything here is a correction, a resolution of something previously undecided, or a decision recorded so it stops being made by accident. Full reasoning per item: `ARCHITECTURE_REVIEW.md`.

### Blockers fixed — v18 could not be built as literally written

| # | Finding | Fix |
|---|---|---|
| A1 | **The matching filter had no backing field on the therapist side.** §8D matched `specialization_needed` against "their skills/expertise," but `users` had no specialization column — `therapist_skills.skill_name` is free text and `course_completions` is a display taxonomy. The pilot's single most important query could not be written. | `users.specializations specialization_type[]` added (§8A), mirroring `age_groups_served`. Matching is `specialization_needed = ANY(u.specializations)`. |
| A2 | **`users.role` was used by matching and the directory but never typed.** | `users.role role_needed_type NOT NULL` (§8A). |
| A3 | **The shortlist transaction never set the referral to `shortlisted`**, and its final statement was malformed (`INSERT ... SET`). Since accept opens by rejecting anything not still `shortlisted`, every accept would have rolled back. | Corrected to an `UPDATE` that writes `status` and `offer_expires_at` (§8D). |
| A4 | **The offer-lapse transaction was never specified and races the accept.** `missed` was described in prose with no transaction writing it, while the sub-hourly scheduler and a live accept can fire on the same referral in the same second. | `lapse_offers()` specified as a third locked function (§8D); lapse-vs-accept added to the required invariant tests. |
| A5 | **The required accept idempotency key had nowhere to be stored.** | `idempotency_keys` table (§8D), checked *inside* the accept function so the guard shares the atomic unit with what it guards. |
| A6 | **`notification_outbox` had no worker-claim mechanism** — no `next_attempt_at`, no lock, no dedupe key, no backoff. Any overlapping cron run produces duplicate sends. | Claim columns and `FOR UPDATE SKIP LOCKED` claiming specified (§8D). |
| A7 | **`expiry_stage` and `shortlist_closes_at` were declared and never defined.** | Both defined (§8D), `shortlist_closes_at` given a row in the timing table. |

### The Hyperdrive question — dissolved rather than mitigated

| Decision | Verdict |
|---|---|
| **The Supavisor session-mode bypass is withdrawn. Both referral transactions — plus the newly specified lapse transaction — become PL/pgSQL functions invoked as a single `SELECT fn(...)` statement.** | A single statement is atomic regardless of pooling mode, so there is nothing left for Hyperdrive's transaction-mode pooling to break. This removes, rather than manages, the second connection path, the fail-closed connection error path, the TCP-handshake latency on accept, and connection-pool exhaustion as a failure mode. Every query in the app now runs over Hyperdrive. Cost, stated plainly: the two most important pieces of business logic live in SQL, tested through migrations against real Postgres. |
| **The concurrency invariant tests are unchanged and remain the launch gate.** | The row lock is still the correctness mechanism — held for microseconds inside the database rather than milliseconds across a network round trip. The design getting simpler is not a reason to test it less. |
| **A Phase 0.5 spike added, before Phases 1–5.** | Proves the race, the pool behaviour, the lapse race, Google Cloud Vision from a Worker, and VAPID signing — against real Supabase from a deployed Worker. If the hosting bet is wrong, it fails here rather than at the Phase 12 launch gate with five phases built on top of it. |

### Architectural decisions recorded rather than left to accident

| # | Decision |
|---|---|
| B1 | **Google Cloud Vision's Node SDK will not run on Workers** (gRPC + ADC), nor will several `web-push` paths. Proven in Phase 0.5 via the REST endpoint with a WebCrypto-signed JWT. Fallback is a Supabase Edge Function for that one job — not a hosting move. |
| B2 | **Public/authenticated layout separation is a Phase 0 architectural rule**, not a Phase 5 task: one `cookies()` call in a shared root layout silently makes the whole tree dynamic and kills directory SEO. Route groups `(public)` / `(app)`, plus a CI assertion on build output. |
| B3 | **Two database roles from Phase 0.** `audit_logs` append-only is only real if the app role differs from the migration owner. Restricted `ahp_app` runtime role, verified by a test that asserts an `UPDATE` is refused. |
| B4 | **All access-tier gating goes through one server-side authz module.** RLS is deliberately not used — the app connects as a privileged role over Hyperdrive, so partial RLS would read as protection that isn't there. Recorded as a decision, not an omission. |
| B5 | **`verification_stage` gets a single writer**, `recompute_verification_stage()`, called only from admin approve/reject and the expiry job. Resolves v18's two-sources-of-truth problem and closes the gap where an expired credential left the stage untouched. |
| B6 | **`notifications` and `notification_outbox` collapse to one write path** — the outbox. |
| B7 | **`areas.ancestor_ids UUID[]`** added, so matching and parent-zone fallback are array containment rather than recursive traversal on every post. |
| B8 | **`profile_contact_reveals`** added — §9 required every public reveal logged, and the dormant direct-mode `contact_reveals` table was not it. |
| B9–B12 | Encryption-envelope call site, Metabase hosting cost, `therapist_skills.verification_status` frozen at `'unverified'`, and Supabase Auth ↔ `users` sync — see §5, §8G6, §8A, §4 respectively, and `ARCHITECTURE_REVIEW.md` §E for the two that remain founder decisions. |

### Product and design corrections

| Item | Verdict |
|---|---|
| **The three badges become one locked component module** with the verbatim §1A copy inside it and tap-accessible tooltips | They carry different claims, must never be confused (§1A, §8C3), and will be consumed by six surfaces. Built once in Phase 1, before anything consumes them. |
| **The no-ranking rule and the footer-legal gate become build-failing tests** | Both are stated as absolute. A test is what makes them absolute; "top therapists in Kondapur" is a natural thing to write and a violation. |
| **All user-facing copy centralised in one file**, with `CONSENT_TEXT_VERSION` alongside it | Several strings are legally load-bearing and pending counsel. A counsel review becomes a single file diff. |
| **The display-wording layer becomes a pure function** with a snapshot test per row of §8D's table | §8D already required it stay separate from the internal enum; that separation survives only if it has a home. |
| **Empty states ship with their surface, not after it** | At 25–30 users the empty state *is* the product on most days for most people (§10D). |
| **Two open product questions surfaced, not resolved here** | The verified-only filter defaulting on strands the `qualification_confirmed` tier it was just invented for; and clinic referrals contradict the home-care framing the table name and §8D2 are built around. Both are founder decisions — `ARCHITECTURE_REVIEW.md` §E4, §E5. |

---

## Full changelog history, v6 → v17

*(Retained for reference — see `decision-history.md` for full detail on earlier revisions. Summary: v7 removed profile pre-seeding in favour of invite-led cold start; v8–v11 built out the referral state machine, credential review states, and name-field split; v12 introduced the shortlist race, replacing v11's sequential model; v13 added recruiting schema, audit-log expansion, admin role separation, and the relay-only pilot scope decision; v14–v15 lost content when built from a stale copy of v13 (later restored in v16–v17); v16 corrected the OCR vendor decision to a single-provider Google Cloud Vision approach; v17 restored content lost in the v14 branch and applied nine implementation-review fixes to the referral shortlist/accept transactions, key management naming, magic-link code lookup, and several schema/documentation gaps.)*

---

## 1. Vision & Positioning

**"The Verified Professional Network for Allied Health Professionals"** — launch messaging scoped honestly to **Physiotherapists, Occupational Therapists & Speech-Language Pathologists**, since that is what the credential types, course taxonomy, and role model are actually built for. Structure stays extensible; messaging does not imply broader coverage than exists.

Core engagement loop: **Professional Identity → Discovery → Referrals → Opportunities → Network → Reputation.**

**Brand:** AHP Network (Allied Health Professionals Network), domain `ahpnetwork.in`, operated by **TheraNet Technologies**. No exact match in Indian trademark search — proceeding, with a formal professional clearance search still recommended before filing (§15B).

**Naming note, standing requirement, not a one-time check:** "AHP Network" sits close to "A&HP," the abbreviation used by India's actual statutory regulator (NCAHP — National Commission for Allied and Healthcare Professions). The mitigation agreed for this: **the operator, TheraNet Technologies, is stated explicitly in the footer and an About page from day one**, and site copy never implies official or regulatory standing ("the official network for...", "registered with..."). This isn't a one-time disclaimer to write and forget — it's a constraint on all future copy, including the badge wording in §1A and any marketing material.

**Relationship to the wider TheraNet product family (Clinic, Sports) is an open question, not yet decided.** Those sibling products still carry the TheraNet brand name while this one (formerly TheraNet Connect) does not — worth a deliberate decision later on whether that's the intended shape of the family or whether it needs revisiting, not something this document resolves.

One platform, two audiences: a therapist/practice-facing app (verification, referrals, networking) and a patient-facing public website (directory, home-visit enquiry) — built for Google visibility.

### 1A. What "Verified" means — and does not mean

This wording appears verbatim on every badge tooltip and in the directory footer.

> **Credentials Verified — [date].** An AHP Network admin has reviewed a document uploaded by this professional and confirmed it appears consistent with the registration details on their profile.
>
> This is **not** a clinical endorsement, **not** a guarantee of current council registration, **not** a recommendation, and **not** an assessment of quality of care. AHP Network does not assess clinical competence.

**Two-tier verification, added in v18 — see §8A2 for the full gating logic.** A degree or postgraduate qualification alone is verified separately, and displayed with a genuinely distinct label:

> **Qualification Confirmed — [date].** An AHP Network admin has reviewed a degree or postgraduate qualification document uploaded by this professional. This confirms the qualification, not current statutory registration to practice, and does **not** unlock referral claiming or patient information.

- Badge label is **"Credentials Verified"** for the full tier, **"Qualification Confirmed"** for the interim tier — never a bare "Verified" checkmark, and never rendered as, or confused with, each other. Same visual-distinction discipline as the practice badge below.
- **Practices use different wording: "Ownership Verified — [date]"**, meaning a business-registration document is on file. This is a weaker and different claim than a council-register check; never render it with either therapist badge component (§8C3).
- The directory footer carries a permanent, non-dismissible disclaimer.
- **No ranking, score, star, or rating language anywhere in v1.** This rule extends explicitly to the dashboard/engagement features in §10H: reciprocity stats are first-person facts, never comparisons, never a leaderboard.

### Product Boundary (hard rule)

Strict separation from **Thera.Net Clinic** (sibling product, see the brand note above on the family-naming question): AHP Network owns identity, verification, discovery, referrals, recruiting, networking. Thera.Net Clinic owns clinical workflow, EMR, documentation. Cross-promotion is fine; embedding clinical functionality is not.

### 1B. Footer, grievance channel, and site-copy discipline

- **Reserve footer space now, on both `/` and `/app/*`**, for *Privacy Policy*, *Terms of Service*, *About / operated by TheraNet Technologies*, and *Grievance Officer: grievance@ahpnetwork.in*. **Do not link to pages that don't exist yet.** A 404 or a stub reads as evidence of an unfinished job — worse, to a therapist deciding whether to trust the platform with credential documents, than no link at all. Populate the links only when counsel delivers the documents (§15A), and hold signups until they're live. The operator attribution is not optional footer content — it's the specific mitigation for the naming risk noted in §1.
- **The grievance inbox must be assigned to a specific admin, checked as part of the weekly ops load (§8A2), before it is published.** A published address routing to nobody defeats the purpose — DPDP's grievance-redressal expectation is about response, not existence of an address.
- **Site copy must read as a professional network, not a service provider — and not a regulatory body (§1).** With patient-facing intake removed (§8D2), the public site is a *directory* — people can find and contact therapists directly, off-platform. AHP Network does not take patient requests, does not route patients, and does not arrange care. Nothing on the site should suggest otherwise. The ToS should still carry a standard independent-contractor/marketplace clause — AHP Network is not a healthcare provider, does not employ or supervise therapists, is not a party to any care relationship — but this is now ordinary boilerplate rather than the load-bearing legal position it was in early revisions.

---

### 1C. Profession expansion — future scope

The network is scoped to PT/OT/SLP for the pilot and stays that way until that loop is proven. When expanding beyond it, add one profession at a time and apply the same density discipline already used for geography (§14: a new locality doesn't open until the existing one clears a threshold) — prove real cross-referral activity with the first addition before adding a second, rather than adding several professions at once and spreading thin density across more categories.

**Next in line, in order:** **Prosthetists & Orthotists** (tight overlap with neuro and amputee rehab, home-visit norms already match), then **Dietitians/Nutritionists** (real overlap in post-surgical, diabetic, and geriatric home care).

Adding a profession is mostly a scope decision, not an architecture change — `role`, `credential.type`, and the `institution_id`/`council_id` FKs (§8A1a, §8B2) are already enum values and reference tables, not schema unique to PT/OT/SLP. What actually gates a new profession:

1. **A verifiable statutory registration** — a real council and a checkable registration-number format. Without this, "Credentials Verified" has nothing to check against for that profession, and admitting one without it dilutes the badge's meaning for everyone else.
2. **Genuine referral overlap** with the existing loop, not merely theoretical adjacency.
3. **Home-visit practice norms**, since the referral board's premise is home-based care.

**Confirm the current registering body and registration-number format for each profession before building its verification path** — several allied-health categories have shifted between the Rehabilitation Council of India and the newer National Commission for Allied and Healthcare Professions framework; treat this exactly like confirming a council before curating a new city.

## 2. Launch Strategy

### Pilot shape

- **Single city:** Hyderabad. Three contiguous localities treated as **one matching zone** at pilot: Kondapur / Gachibowli / Madhapur.
- **Two specialties:** musculoskeletal/orthopaedic PT and neuro rehab.
- **Target supply:** 25–30 verified, active therapists before referral matching is meaningful.
- **Duration:** 60–90 days.
- **Cohort acquisition is invite-led**, not directory-led. No profile exists on the platform that the person did not create themselves.

### Cold start — invite-led, not seed-led

1. Direct outreach to known professional circles — colleagues, college cohort, methodology-course peers.
2. Each onboarded therapist gets an invite link (§8A4) to bring in peers.
3. Practices invite their own staff rather than creating accounts for them (§8C2).

This costs directory density on day one and buys a clean consent position, no claim/merge/dispute surface, and no legal blocker. It is the right trade at this size.

**Two founder-personal tactics, deliberate and not meant to scale past the pilot — added in v18:**
- **Personally post real referral cases through the platform, spread across the cohort rather than concentrated on the first few eager adopters.** Someone who verifies, checks the app for two weeks, and never once sees a relevant referral is a much likelier churn than someone who got even one small one early. This is the single best available lever for making the platform not feel empty at 25–30 people, and it doubles as a direct, personal test of §11's WhatsApp-displacement hypothesis.
- **A personal WhatsApp nudge, not just the T+3d/T+10d email drip (§8A3), for anyone who stalls on credential upload.** Doesn't survive past the pilot, and shouldn't — it's cheap specifically because the cohort is small, and it will convert stalled signups the automated drip won't catch in time.

### Verification SLA

- **Internal target: <24 hours.** **User-facing copy: "usually within 2 working days."** Never publish an SLA tighter than the one you can staff.
- Admin receives a digest of pending items; queue-depth alert at 15.
- **Minimum two admins** before any real signups.

### Launch gates

Everything in §13 "Pilot Scope" ships together. The following are **gated on measured density**, not on build completion:

| Gated feature | Gate |
|---|---|
| Locality-level referral matching (vs. single-zone) | ≥8 verified active therapists per specialty in each locality |
| Public/patient home-visit referrals (v1.5) | All go/no-go criteria in §14 met for two consecutive weeks |
| Second city | §14 criteria met, plus a curated `areas` set for that city |
| Communities generally *(fully specified in §8E3)* | **≥100 verified active therapists in the city** |
| **One exception: the founding-cohort Community** *(NEW in v18)* | **None — ships at pilot launch, day one, regardless of headcount.** See §8E3's "Founding-cohort exception." This is the in-app replacement for what §13 already planned to run manually as a WhatsApp group — same substitute, moved in-app, using mechanics already fully specified rather than new build |
| Circles *(§8E2)* | None — personal utility, ships independent of network density |
| **Recruiting — active claim solicitation begins** *(refined in v18)* | **~100 verified active therapists in the city** — this is the trigger to start actively pushing practice owners toward claiming their listings; it does not by itself unlock the vacancy board |
| **Recruiting — vacancy board surface ships** *(refined in v18)* | **≥5 approved `practice_claims` in the city**, in addition to the headcount trigger above. Headcount alone risks the exact empty-board problem §8F identifies — a city can be well past 100 therapists with zero claimed practices, since claiming follows owner effort, not therapist signups |
| Blog | §13 deferral conditions |

---

## 3. Monetization

- **No price displayed in v1.** Pricing is deferred until there is retention data.
- **Peer-to-peer therapist referrals: free, permanently.** This is the network's core reciprocity loop and must never be paywalled.
- **Patient/home-visit referrals were the intended paid tier. That feature is removed from scope (§8D2), so no revenue path remains in the plan.** This is correct for a 60–90 day pilot and should not be corrected by adding one — but it should be a conscious position, not a later discovery. When patient referrals eventually return: **paid from the day the feature launches**, not free-then-restricted, with founding-cohort members receiving permanent free access as a stated benefit.
- Institutional surfaces (vacancies, course/event listings): future.
- **Never charge for verification itself.**

### Future monetization roadmap (not priced, not scheduled)

Captured here as a considered future scope, not a commitment — none of this is built or priced until pilot activation data says which of it is worth building. **Same rule as everything else in this section: verification and peer referrals stay free permanently, regardless of what else is monetized.**

**Therapist paid tier, once revisited:**
- **Profile insights** — views, contact-reveal counts, referral response rate. Repackages telemetry the platform already logs for its own supply-gap tracking (§12); near-zero marginal build cost.
- **Digital verified-profile card** — downloadable PDF/QR carrying the Credentials Verified badge, for referral letters, clinic signage, visiting cards.
- **Patient direct appointment booking** — a genuinely bigger build than the two above. Revisit only once relay-mode referral volume (§11) shows real demand for a booking flow beyond the current poster-mediated model.

**Practice-side monetization — kept as its own track:**
- **Practice storefront page** — a richer, shareable page for claimed practices: hours, services, photos, a booking-*request* form. Mostly assembles data already collected via `practice_claims`.
- **Local demand insights, for practices** — an aggregated, anonymized view of the unserved-urgent and empty-pool data already computed for internal ops (§12), sold to a practice deciding where to hire.

**Sponsored content (equipment vendors, course providers)** — held separate, gated on reaching multiple cities. This is the one category that risks eroding the ad-free registry positioning (§1) if introduced casually.

---

## 4. Auth & Security

**Authentication mechanism, revised in v18: Supabase Auth, not a custom-built system.**

- **Google OAuth + email magic link/OTP**, both handled natively by Supabase Auth — no custom code hashing, attempt counting, or code-lookup logic to build or audit. This removes a real, hand-rolled security surface (v17's custom Argon2-based magic-link implementation) in favour of a library already running on the same Supabase project as the database, covering exactly the two methods needed and nothing else.
- **On mobile user-agents, the 6-digit-code path remains the default**, with the click-through link secondary — this is a UX decision about which Supabase Auth flow to present first, not something the auth provider changes. (Email apps open links in an in-app browser that does not hold the session — a well-documented 30–40% drop.)
- **Why not Clerk:** considered and rejected. Clerk's real advantages — richer prebuilt UI components, broader auth-method variety, org/team primitives — solve problems this product doesn't have (two login methods, no multi-tenant structure). Adopting it would mean a second vendor, a second free-tier quota to track, and duplicate profile-sync work (neither provider stores AHP-specific fields like `legal_name`/`account_type` natively — that sync work exists either way). Staying on Supabase Auth is one fewer vendor for capability that isn't needed.
- **CSRF:** Next.js Server Actions' Origin-header checking; explicit CSRF tokens on any standalone API route.
- **Sensitive identity change protocol — unchanged, app-level logic that sits above whatever issues the session.** A "sensitive identity change" is any of: email change, phone change, linking or unlinking an auth identity, or `legal_name` change. On any of these:
  1. **Require recent re-authentication** — a session older than 15 minutes must re-authenticate before the change is accepted.
  2. **Notify BOTH the old and the new verified channel.**
  3. **Block referral acceptance and any contact disclosure for 48 hours.** The account keeps working for everything else — browsing, profile edits, credential upload.
  4. Write `audit_logs` with `action = 'sensitive_identity_change'`.
- WhatsApp OTP deferred to v2 — but see §8D on notification dependency.

---

## 5. Data Privacy & PII

- **Application-level encryption (AES-256-GCM) on any field holding personal contact information that is never used as a lookup key.** In relay-only pilot operation this is a small surface — the patient's phone number is never collected (§8D) — but the envelope format below is mandatory from the first encrypted field, because retrofitting key versioning onto existing ciphertext is not possible.
- **Key management — [v19] resolved.** The rule was that whichever runtime performs the encryption owns the key, to be decided during the OpenNext spike. That spike has happened (Phase 0.5): the Worker does the encrypting, so the key is a secret in **Cloudflare Workers Secrets**. Supabase Vault applies only if a specific job is ever moved into an Edge Function, which is a per-job decision and not the default.
- **[v19] The one encrypted field at pilot is `users.public_contact_value`** — the therapist's own phone or WhatsApp number, never used as a lookup key, which is exactly the criterion above. v18 left §5 with no named call site at all: relay collects no patient phone, `contact_reveals` is dormant for the entire pilot, and `users.email` is excluded below. Naming the field now is the point of the section — discovering after launch that this column should have been enveloped is precisely the retrofit this section says is impossible.

**What this buys, stated honestly:** protection against database compromise, not against disclosure. The value is revealed to the public on tap by design (§9); encryption at rest is not pretending otherwise. Cost is one decrypt per reveal and one on profile edit. A second encrypted field is a deliberate act, not drift.

**`users.email` is NOT encrypted, and cannot be under this scheme.** It's the login lookup key — AES-GCM ciphertext is not equality-searchable without a separate deterministic index, which is real added complexity for a field that is already a required, human-visible identity field and not the sensitive surface here (patient contact data is).

**Encryption envelope.** Never store a bare ciphertext column. Every encrypted value is stored as a consistent structure:

```json
{
  "v": 1,                      // envelope format version
  "kid": "key-2026-08",        // key ID — which key encrypted this
  "alg": "AES-256-GCM",
  "iv":  "base64...",          // nonce, unique per encryption
  "ct":  "base64...",          // ciphertext
  "tag": "base64..."           // auth tag
}
```

Without `kid`, key rotation is impossible. Without a per-value `iv`, AES-GCM is catastrophically insecure. Both are cheap now and unfixable later.
- `contact_reveals.revealed_data` uses a defined JSON schema with encrypted phone/email sub-fields — not a freeform blob.
- `audit_logs.before_state/after_state` **redact PII before storage.**
- **Soft delete alone does not satisfy an erasure request.** See §8H.
- **Data export:** background job producing a JSON + PDF bundle, delivered as a 24-hour presigned link by email. Never a synchronous download.
- **Deletion request:** in-app request creating an admin task with a defined SLA. Not an instant button.

---

## 6. Location Handling

**Two distinct mechanisms. Do not conflate them.**

### Home-visit coverage and referral matching → curated `areas` table

- A hand-curated Hyderabad locality set, ~100–150 rows, grouped under 6–8 parent zones, authored from local knowledge.
- **Google Places is NOT used for this.** Autocomplete mixes establishments, sublocalities, localities, and administrative areas in one result list. Matching compares `home_visit_areas.area_id` to `home_case_referrals.area_id` — mismatched IDs produce a **silently empty pool** that is indistinguishable from a genuine density problem.
- Curated areas additionally give: a real parent chain for the empty-pool fallback (§8D), stable slugs for SEO routes, and a zero-network-call selector on mobile.

### Practice addresses → Google Places

- Places Autocomplete with `sessionToken` + 300ms debounce, `google_place_id` stored as the canonical identifier.
- Lat/long retained on `practices` for map embeds and city-level directory search.

### Multi-city expansion

Curate each new city by hand at first (30–50 major localities). The All India Pincode Directory (data.gov.in, Open Government License India) is the fallback for cities nobody on the team knows — **verify the current licence terms for commercial use before relying on it.** Not needed for the pilot.

---

## 7. Architecture

Single Next.js codebase (PWA), single PostgreSQL database (Drizzle ORM), route + auth split:

```
ahpnetwork.in/              → public, SSR, no auth
ahpnetwork.in/app/*         → therapist/practice only, auth-gated
```

### Canonical infrastructure — cleaned up in v18

**v17's infra checklist referenced S3, CloudFront, and Vercel Analytics alongside a Cloudflare hosting decision made in §7 — leftover from before that decision, never reconciled. This is corrected here, not re-decided:**

| Layer | Canonical choice |
|---|---|
| Hosting/runtime | **Cloudflare Pages/Workers**, via `@opennextjs/cloudflare`. Netlify remains the fallback if the adapter proves troublesome. |
| Database | Supabase PostgreSQL, Drizzle ORM (**migrate**, not push) |
| Authentication | **Supabase Auth** (§4) |
| Object storage | **Cloudflare R2** for all uploads — credential documents, profile photos, database backup archives. Private objects (credential documents) served via time-limited signed URLs; profile photos public via CDN. **S3 and CloudFront are removed from the launch architecture entirely** — not referenced anywhere in the pilot build. |
| CDN | **Cloudflare CDN** (native to the Pages/Workers deployment) |
| Analytics (site traffic) | **Cloudflare Web Analytics.** Vercel Analytics removed — it was a reference to a hosting stack no longer in use. Keep product-event instrumentation provider-agnostic so a dedicated product-analytics tool can be layered on later if needed. |
| **Internal ops/admin analytics** *(revised [v19])* | **Deferred for the pilot; §12's metrics run as saved queries against a restricted `analytics` view layer.** Still not a custom-built admin analytics page — §8G6's split is unchanged, only the tool's arrival moves. v18 called Metabase free because it is open source, but it needs a container host with ~2GB RAM, which Workers is not: that is a real monthly bill and a second ops surface inside a plan whose premise is a genuinely free tier. The view layer and its read-only role are built in Phase 0 regardless, so Metabase points at a safe surface whenever it does arrive. |
| **UI** *([v19])* | **Tailwind CSS + shadcn/ui.** Components are copy-in source living in the repo, not a runtime dependency — which matters on Workers, and follows the same reasoning §7 used to prefer OpenNext over `vinext`: prefer the option with the most existing troubleshooting precedent for a solo build. A token layer is established in Phase 0, before any screen is built on it. |
| Error monitoring | Sentry (free tier) |

**Backup plan for free-tier Supabase.** Free tier has zero backup retention. The plan's own cron jobs hit the database daily, which prevents the free-tier 7-day inactivity pause. What's required: a **nightly `pg_dump` to Cloudflare R2**, scheduled via GitHub Actions, 30-day rotation — **kept nightly, not shifted to 12-hour** (considered in this revision and rejected: marginal RPO gain, doubled cron/write frequency, not worth it at pilot scale) — plus a **separate backup for the storage bucket**, since credential documents live outside Postgres. Test a restore before launch and quarterly after.

**Growth triggers, expressed relative to current quotas rather than hardcoded figures (revised in v18):**

| Trigger | Action | Last verified |
|---|---|---|
| Supabase storage or database size >80% of applicable free-tier cap | Supabase Pro (~$25/mo) | Confirm current cap before launch |
| R2 storage/operations approaching the applicable included allowance | Review usage, no action needed below this | Confirm current allowance before launch |
| Google Places spend approaching ~75% of the applicable free credit | Budget alert should already have fired — confirm it's set before this ever happens | Confirm current credit amount before launch, do not assume a fixed dollar figure |
| **Hyperdrive daily query count approaching the Workers Free plan's 100,000/day allowance** *(NEW, checked directly against current Cloudflare pricing)* | **This is the more realistic early-warning signal than raw request count**, since nearly every request to this app triggers at least one database query — likely to bind before the separate 100,000-requests/day Workers limit does. Upgrading to Workers Paid ($5/month flat, includes 10M requests + 30M CPU-ms) removes both limits at once. | Confirm current allowance before launch — this is exactly the kind of number Cloudflare could revise |
| **[v19] Supabase connection utilization sustained above ~70% during peak hours** (Hyperdrive's origin connections; the Supavisor session-mode pool this row previously named is no longer used) | Scaling signal, not an emergency — review whether Supabase Pro's larger compute tier or connection-limit increase is warranted before it becomes a real constraint | Add as a dashboard alert (§8G6, §12), not just something to remember to check |

**On budgeting for Cloudflare's own paid tier specifically:** the $5/month Workers Paid minimum is very likely to cover this app's traffic for a long runway — its included 10 million requests and 30 million CPU-ms per month is large relative to a professional directory and referral board's realistic usage, even well past 1,000–2,000 users. Don't budget for a climbing per-user Cloudflare cost; budget for the flat $5/month floor as a near-certainty once real 24/7 traffic exists, and treat anything beyond that as a genuine surprise worth investigating, not an expected scaling cost.

**Database connection strategy — Cloudflare Hyperdrive is used from day one, not deferred.** Cloudflare Workers cannot hold a traditional long-lived Postgres connection efficiently — every cold invocation pays a fresh TCP+TLS handshake without it. Hyperdrive is the deliberate, informed cost of staying on Cloudflare's genuinely free tier through the pilot rather than paying for traditional Node hosting (Railway/Render, realistically $5–12/month once truly always-on) up front.

**The known trade-off, and how v19 removes it rather than managing it.** Hyperdrive operates in transaction-mode pooling only; Cloudflare's own documentation cautions against leaning on this for long, multi-statement transactions holding locks — exactly the shape §8D's referral transactions had when written as `BEGIN; SELECT ... FOR UPDATE; UPDATE; INSERT; COMMIT` from the application.

**v18's answer was to bypass Hyperdrive for those two transactions via a direct Supavisor session-mode connection. [v19] That decision is withdrawn.** The three referral state transitions — `shortlist_referral()`, `accept_referral()`, and the newly specified `lapse_offers()` — are PL/pgSQL functions, each invoked as a **single** `SELECT fn(...)` statement. A single statement is atomic by definition, whatever the pooling mode. There is nothing left for transaction-mode pooling to break, so there is nothing left to bypass.

**What this deletes, all at once:** the second connection path, the fail-closed error path that path required, the TCP handshake on every accept, and connection-pool exhaustion as a failure mode. Every query in the application — including the referral transactions — runs over Hyperdrive. `db.ts` has one connection path, not two.

**What it costs, stated plainly:** the two most consequential pieces of business logic in the product live in SQL rather than TypeScript, and are tested through migrations against a real Postgres rather than in application test code. That is the right trade for exactly these functions — atomicity matters more than authoring convenience here, and they change rarely — and it is not a precedent for putting other logic in the database.

**The concurrency invariant tests in §8D remain non-negotiable.** The row lock is still the correctness mechanism; it is simply held for microseconds inside the database instead of milliseconds across a network round trip. A simpler design is not a tested design.

**Next.js deployment adapter: OpenNext (`@opennextjs/cloudflare`), not Cloudflare's newer `vinext` — decided, checked against current state, not a default left unexamined.** Cloudflare's own docs now promote `vinext` as its recommended path, but as of this decision `vinext` is explicitly labeled experimental by Cloudflare itself, the majority of its code and tests were AI-written with minimal human review by Cloudflare's own account, it has already had security vulnerabilities found and patched within its first weeks, and it does not yet support static pre-rendering at build time — directly relevant to this app's SEO-driven public directory. Even `vinext`'s own documentation states OpenNext is "more mature and battle-tested." OpenNext has known friction of its own — this whole hosting review started there — but it has years of real production precedent, which matters enormously for a solo build relying on Claude Code, since there's far more troubleshooting precedent to draw on than for something this new. Revisit only once `vinext` has real production maturity behind it, not before.

**Two rules that make a future hosting move cheap, regardless of whether one ever happens:**
- **R2 access always goes through R2's standard S3-compatible API, never Cloudflare's native binding API.** R2 is deliberately S3-compatible so the same client code runs unchanged on Workers, Railway, Vercel, or a VPS — this single decision is what most determines how expensive a future hosting move would be.
- **All database connection setup lives in one isolated file, never inlined or duplicated across the codebase.** **[v19]** There is exactly one connection path — Hyperdrive — so this file is small; keeping it that way is what makes a future swap to a direct connection string a one-file change rather than a search-and-replace across every route.

**Do not use Vercel Hobby at any point, including as a bridge before monetization.** Vercel's own terms define commercial use by whether this is a business project at all — a pilot serving real professional users as part of a real business is commercial from day one under their policy, regardless of whether pricing has launched. If Vercel is ever used, it must be Pro.

**Railway/Vercel are a conditional fallback, not a scheduled revisit.** Cloudflare is the committed platform for the pilot and beyond, unless one of these specific triggers fires — not a calendar date, not the question being raised again in the abstract:

| Trigger | Action |
|---|---|
| A concurrency invariant test (§8D) fails against the PL/pgSQL functions over Hyperdrive, and cannot be resolved within Workers' constraints | Reassess hosting immediately — this is the one trigger that overrides everything else, since it's the core mechanic failing. **[v19] Proven or disproven in Phase 0.5**, before Phases 1–5 are built on the assumption |
| Real Workers CPU-time or wall-clock limits are hit under genuine pilot load (verify current limits during Phase 0, since these are exactly the kind of number that shifts — don't build against a stale assumption) | Profile first; only move hosts if the limit is structural, not a fixable inefficiency |
| Node.js compatibility gaps block a genuinely necessary package with no workaround | Check compatibility before adopting any new dependency in the first place — this should rarely reach the trigger stage |
| Real infrastructure cost (Supabase Pro + Cloudflare paid tiers, if reached) exceeds what Railway/Render would have cost, with no remaining Cloudflare-specific benefit being used | Reassess — the whole point of staying on Cloudflare was cost, so if that stops being true, revisit |
| **A fifth trigger, deliberately human rather than technical: more than roughly 20% of development time goes to debugging Cloudflare-specific issues (Wrangler, edge-runtime quirks, Worker traces) instead of product features** *(NEW)* | **Reconsider hosting even if every individual issue is technically resolvable.** None of the four technical triggers above capture "survivable one at a time, but death by a thousand small papercuts" — which is a genuinely real risk pattern for a solo founder with limited time, distinct from any single hard blocker. The 20% figure is illustrative, not scientifically derived — trust your own sense of where time is actually going over the technical threshold. The platform exists to serve the product, never the reverse; if ops debugging starts eating time that should go to recruiting therapists or refining UX, that's reason enough on its own. |

**[v19] Fail-closed, not fail-open, on any referral transaction error.** When a referral function raises — a lost race, a failed rowcount assertion, a connection error — the endpoint surfaces the specific message §8D specifies ("one of your choices is no longer available, pick again" / "went to someone else"), or a plain "please try again" for an infrastructure failure. It never retries blindly, never partially applies, and **never falls back to a client-side reimplementation of the same logic** — that fallback would reintroduce precisely the multi-statement pattern the function form exists to eliminate. Same fail-closed discipline the shortlist logic already uses at the row level, extended to the call layer.

**Hard gate: the referral board does not go live to real users until the concurrency tests pass against the deployed system — the actual functions, called over Hyperdrive from a real Worker — not just the transaction logic in isolation.** This is a go/no-go gate on the pilot itself, not merely a "done when" criterion buried in a build phase — see Phase 12 in `BUILD_SEQUENCE.md`, where this is now explicit. Two distinct tests, testing different things, both required:
1. **Race-correctness test** — concurrent accept attempts on the *same* referral. Since the shortlist is capped at 2 candidates, this is fundamentally a 2-way race, not an arbitrary number — verify exactly one accepts, the other correctly resolves to `not_selected`, zero dangling rows, zero duplicates.
2. **Connection-pool load test** — many concurrent transactions fired across *many different* referrals simultaneously (order of dozens), verifying **[v19] Hyperdrive's pool** holds up under aggregate concurrency, not just that the row-locking logic is correct for one race. This tests the connection layer; the first test tests the business logic. Conflating them tests neither properly.
3. **[v19] Lapse-vs-accept race** — the deadline scheduler's `lapse_offers()` and a therapist's `accept_referral()` firing against the same referral simultaneously. A distinct race from the first test, and one v18 never specified a transaction for at all (§8D).

**Caching strategy — kept simple.** Framework-native caching/ISR for public directory pages where safe. **Do not cache** credential verification state, referral state, or anything administrative action touches. **Cloudflare KV is explicitly P1** — not built unless profiling shows an actual need.

### Infrastructure (pre-launch checklist)

- **Test every critical path (signup, referral post, shortlist, accept, profile edit) via `wrangler dev`, not just `next dev`, before considering a phase complete.** `next dev` runs on standard Node.js locally; production runs on Workers' V8 isolates — a genuinely different runtime, not just a different deployment target. Code that passes local testing under `next dev` can behave differently or fail outright once actually deployed, for the same reason the pooling-mode risk below is dangerous: it works in the wrong environment and only reveals itself in the right one.
- **[v19] Connection pooling:** Hyperdrive for every query, including the referral transactions. **The session-mode requirement v18 stated here is withdrawn** — it existed because the referral transactions were multi-statement and client-held; as single-statement function calls they are atomic under transaction-mode pooling. What replaces it as the thing to verify: that no referral state transition has been re-implemented as a sequence of client-side queries. That, not the pooling mode, is now the failure condition.
- **[v19] Two database roles.** Migrations run as the owner; the application connects as a restricted `ahp_app` role with `UPDATE`/`DELETE` revoked on `audit_logs` (§8G). Append-only enforced at the database level is only real if the application role is not the role that granted it — verify with a test asserting the write is refused.
- **[v19] Public and authenticated layouts are separate route groups** — `(public)` and `(app)`, established before any page exists. A single `cookies()` or `headers()` call in a shared root layout opts the entire tree into dynamic rendering and silently kills static generation for the SEO-driven directory. Nothing errors; it just stops being static. Assert on build output in CI.
- **Observability:** Sentry + Cloudflare Web Analytics + structured logging.
- **Upload security:** short-lived signed R2 upload URLs, browser uploads directly to R2. File-type whitelist (PDF/JPG/PNG/WebP for photos; **PDF only** for credential documents), size caps (10MB photos, 5MB credential documents as a central configurable constant), **server-side magic-byte validation** (`%PDF-` for PDFs — never trust file extension or browser-reported MIME type). Credential documents are **private objects**, served via time-limited signed URLs to the owner and admins only. Do not render or execute embedded content from uploaded PDFs. Do not mark a credential verified merely because upload succeeded — OCR is verification *assistance*, admin review remains authoritative.
- **Client-side compression before upload for photos** (WebP/JPEG, target <1MB). **Credential documents are not compressed** (no canvas re-encoding — this can corrupt document legibility for OCR and for the human reviewer). **Compression can fail outright on lower-memory Android devices** — on failure, never discard the user's local file selection; preserve it, surface a plain retry, offer "upload without compressing" as a fallback. Uploads must be cancellable mid-flight and resumable.
- **Engineering practices:** branch strategy, CI (lint/type-check/test), staging environment, documented rollback plan.

---

## 8. Data Model

### A. Verified Profiles

```sql
users (
  id, email, photo_url,
  slug,                                 -- unique among active profiles
  profile_visibility,                   -- 'public' | 'unlisted' | 'hidden'
  profile_status,                       -- 'draft' | 'active' | 'suspended'
  contact_preference,                   -- 'phone' | 'whatsapp' | 'form_only' | 'none'
  public_contact_value,                 -- only rendered via reveal-on-tap (§9).
                                        -- [v19] ENCRYPTED via §5's versioned envelope — the pilot's one
                                        -- encrypted field. Decrypted at reveal (§9) and at profile edit.
  account_type,          -- 'therapist' | 'practice_manager' | 'staff'
  legal_name,            -- as printed on credentials; verification matching only
  display_name,          -- what appears publicly — the ONLY name shown anywhere public
  role role_needed_type NOT NULL,        -- [v19] typed against §8D's enum. Was an untyped column in v18,
                                          -- which left the matching filter's first clause undefined.
  specializations specialization_type[] NOT NULL DEFAULT '{}',
                                          -- [v19] NEW. The matching filter (§8D) compares against this and
                                          -- nothing else. v18 matched specialization_needed against
                                          -- "their skills/expertise" with no queryable field behind it —
                                          -- therapist_skills.skill_name is free text, course_completions is
                                          -- a display taxonomy. Same shape and same no-gating treatment as
                                          -- age_groups_served below.
  bio, years_experience, tele_rehab_available,
  gender,                                -- NEW in v18: nullable, self-reported, optional at profile
                                          -- setup. A directory filter, not a badge — see §9. Not
                                          -- mandatory: a therapist can leave it blank and it simply
                                          -- doesn't appear as a filterable attribute for that profile.
  languages TEXT[],
  accepts_clinic_visits BOOLEAN DEFAULT true,
  accepts_home_visits   BOOLEAN DEFAULT true,
  -- NEW in v18: wired into referral matching (§8D) — previously present
  -- but unused by any query. A home-visit referral now only notifies
  -- accepts_home_visits = true; a clinic referral only notifies
  -- accepts_clinic_visits = true. A therapist can be true on both.
  accepting_referrals BOOLEAN NOT NULL DEFAULT true,
  -- NEW in v18: separates "I have this skill" from "I want referrals for
  -- it right now." Directly reduces irrelevant notifications — the core
  -- lever on whether this feels better than a WhatsApp group. Surfaced
  -- as a one-tap toggle next to available_for_new_patients (§9, §10),
  -- not buried in a settings page.
  availability_notes TEXT,
  verification_stage,                    -- profile_verification_stage enum, see §8A1a — replaces the old
                                          -- single verification_status column
  available_for_new_patients BOOLEAN NOT NULL DEFAULT false,
  availability_updated_at TIMESTAMPTZ,
  open_to_opportunities,
  referral_code,
  invited_by_user_id,
  deleted_at, created_at, updated_at
)
```

**`account_type` — add now, while the table is empty.**

```sql
CREATE TYPE account_type AS ENUM ('therapist','practice_manager','staff');
ALTER TABLE users ADD COLUMN account_type account_type NOT NULL DEFAULT 'therapist';
CREATE INDEX users_directory ON users (account_type, verification_stage)
  WHERE deleted_at IS NULL AND account_type = 'therapist';
```

**All directory, matching, metrics, and nudge queries filter `account_type = 'therapist'`.**

**[v19] `specializations` — the matching filter's only backing field.**

```sql
ALTER TABLE users
  ADD COLUMN specializations specialization_type[] NOT NULL DEFAULT '{}';
CREATE INDEX users_specializations ON users USING gin (specializations);
ALTER TABLE users ALTER COLUMN role TYPE role_needed_type USING role::role_needed_type;
```

Self-reported, multi-select, set during profile completion (§10G) — a therapist working across both pilot specialties selects both. **`therapist_skills` is unaffected and stays the display and directory-chip surface**; it is not, and must never become, a matching input. An empty array means the therapist receives no referral notifications, which is a meaningful and recoverable state, not an error — but it is worth surfacing in the completion checklist, since a verified therapist with no specializations set is invisible to the referral board while appearing fully set up.

**`gender` — new in v18, self-reported, optional, nullable.**

```sql
CREATE TYPE gender_type AS ENUM ('male','female','non_binary','prefer_not_to_say');
ALTER TABLE users ADD COLUMN gender gender_type;
```

Not asked at signup — offered as an optional field during profile completion (§10G), alongside the same accuracy discipline as every other field there: it exists to serve a real directory filter (§9), not to gate anything, and skipping it costs nothing. `'prefer_not_to_say'` is a distinct, explicit choice, not the same as leaving it null — it lets a therapist actively decline without the field silently defaulting to "not shown," which is a meaningfully different signal from "hasn't gotten to this field yet." A profile with `gender IS NULL` or `'prefer_not_to_say'` simply doesn't match a gender filter — no visible penalty, no incomplete-profile flag tied to it.

**Display rule, decided this round: `gender` is filter-only, never rendered on the public profile card.** It exists to serve a real, practical filter (home-visit comfort), but showing it on the profile itself reads as a personal-identity label on a professional page rather than a search convenience — kept deliberately off §8C3's profile layout for this reason. Contrast with `age_groups_served` immediately below, which *is* shown, since that's professional scope information, not a personal attribute.

**`age_groups_served` — new in v18, self-reported, optional, multi-select.**

```sql
CREATE TYPE age_group_type AS ENUM ('pediatric','adult','geriatric');
ALTER TABLE users ADD COLUMN age_groups_served age_group_type[] NOT NULL DEFAULT '{}';
```

Kept deliberately separate from `specialization_type` (§8D) rather than folded into it — specialization is a pilot-scoped enum tied to the two referral specialties (§2) and to what's credentialed; age group is a different axis entirely (who a therapist treats, not what condition). Mixing the two would force `specialization_type` to grow combinatorially (`neuro_rehab_pediatric`, `neuro_rehab_geriatric`, ...) for no benefit. A therapist can select more than one — most general-practice therapists will. Same no-gating treatment as `gender`: an empty array just means the profile doesn't surface under an age-group filter, nothing else changes.

**Display rule, decided this round: shown on the public profile, as tags alongside Core Expertise/Also Trained In (§8C3).** Unlike `gender`, this is professional scope information — comparable to a specialization, not a personal attribute — so it belongs on the profile card, not filter-only.

**`auth_identities`.**

```sql
CREATE TABLE auth_identities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id),
  provider            TEXT NOT NULL,          -- 'google' | 'email'
  provider_account_id TEXT NOT NULL,
  email_at_link       TEXT,
  linked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX auth_identities_provider_account
  ON auth_identities (provider, provider_account_id);
CREATE INDEX auth_identities_by_user ON auth_identities (user_id);
```

Populated from Supabase Auth's own identity records on sign-in/link — this table remains the AHP-specific mapping regardless of which auth provider issues the session.

**[v19] How a `users` row comes into existence, which v18 never stated.** `users.id` **equals** `auth.users.id`. The row is created by a **server action on first sign-in, not a database trigger** — it needs to set `account_type` and `is_founding_member` (§10A), and a server action is testable, debuggable, and reviewable in a way a trigger is not. The same action upserts `auth_identities`. Every downstream query joins on that shared id, so there is no separate mapping table and no sync job.

**`slug`, visibility, and status.**

```sql
CREATE UNIQUE INDEX users_active_slug ON users (slug)
  WHERE profile_status = 'active' AND deleted_at IS NULL;
```

**Public eligibility must never be inferred from `account_type` alone.** Directory queries filter on `account_type = 'therapist' AND profile_status = 'active' AND profile_visibility = 'public'` — all three, every time.

**`legal_name` / `display_name`.**

```sql
ALTER TABLE users
  ADD COLUMN legal_name   TEXT,   -- matched against OCR output; never displayed
  ADD COLUMN display_name TEXT;   -- directory, profile, referral board
```

Collect `legal_name` **at credential upload**, not at signup: *"Enter your name exactly as printed on your certificate. This is used only for verification and won't appear on your profile."* Verification matches `legal_name`; everything public renders `display_name`.

**Removed:** `users.name` (superseded by the split above), `practice_style`, `notification_preferences` JSONB.

**Deferred:** `profile_stats` and the async job behind it — see §3's future "Profile insights" paid tier, which is the same concept. **`bookmarks` is no longer a separate deferred item** — it's now fully specified as Circles (§8E2), given named-list structure instead of a flat list.

```sql
therapist_skills (
  id, user_id, skill_name, category,
  competency skill_competency_level DEFAULT 'practicing',
  proof_url,
  verification_status,                           -- 'unverified' | 'pending' | 'verified'
                                                 -- [v19] PILOT SHIPS 'unverified' ONLY. There is no queue,
                                                 -- no admin action, and no gating logic anywhere that reads
                                                 -- this. A third verification vocabulary alongside
                                                 -- credential_status and verification_stage is exactly the
                                                 -- badge confusion §1A exists to prevent — build no path
                                                 -- that writes another value, and no surface that shows it.
  deleted_at, created_at, updated_at
)

credentials (
  id, user_id, type,                             -- type is now credential_type enum, see below
  registration_number,                            -- superseded institution_or_council free text, removed in v18:
                                                   -- institution_id and council_id below are the FKs that
                                                   -- replace it, matched via §8A2's OCR + curation pipeline
  institution_id,                                -- FK to master_institutions, §8B2
  council_id,                                    -- NEW in v18, FK to master_councils, see below.
                                                  -- Required when type = 'council_registration', NULL otherwise.
  document_url,                                  -- private R2 object, signed access only
  ocr_extracted_json,
  status,
  query_message,
  query_raised_at, query_raised_by_admin_id,
  query_responded_at,
  expiry_date, verified_by, verified_at,
  deleted_at, created_at, updated_at
)

home_visit_areas (
  id, user_id, area_id, deleted_at, created_at, updated_at
)
```

**Credential review states.**

```sql
CREATE TYPE credential_status AS ENUM (
  'pending', 'under_review', 'query_raised', 'approved', 'rejected'
);

ALTER TABLE credentials
  ADD COLUMN query_message TEXT,
  ADD COLUMN query_raised_at TIMESTAMPTZ,
  ADD COLUMN query_raised_by_admin_id UUID REFERENCES admin_users(id),
  ADD COLUMN query_responded_at TIMESTAMPTZ;

CREATE INDEX credentials_awaiting_therapist
  ON credentials (query_raised_at) WHERE status = 'query_raised';
```

**Approve · Raise query · Reject**

- *Raise query* is one action with a free-text message, covering both content discrepancies and document quality.
- **`query_raised` items leave the main queue** and sit in a separate "Awaiting therapist" list, so they don't inflate the queue-depth number that drives the SLA.
- The therapist's response returns the item to `under_review`.
- Auto-nudge at 7 days; auto-close at 30.
- **Rejection is reserved for genuinely unverifiable submissions.**

**Credential expiry flow:**
1. 30 days before `expiry_date`: notify therapist to renew.
2. On expiry: "Verification Expiring" shown to the therapist only — 30-day grace, public badge unaffected.
3. After grace: public badge removed, profile marked "Verification Lapsed" (profile stays live, **referral claiming is suspended**).
4. Re-upload triggers the normal flow.

---

### A1a. Two-tier verification — NEW in v18

**Why this exists:** NCAHP enrollment for physiotherapists is early-stage nationally — most currently practicing therapists hold a state council or paramedical board registration, sometimes alongside IAP membership, not yet NCAHP specifically. Gating the full badge on NCAHP alone would mean most physiotherapists could never earn "Credentials Verified" during the window while national enrollment catches up. The fix is a genuine second tier, not a lowered bar — a degree alone still never unlocks referral claiming or patient data.

```sql
CREATE TYPE profile_verification_stage AS ENUM (
  'unverified', 'qualification_confirmed', 'credentials_verified'
);
ALTER TABLE users
  DROP COLUMN verification_status,
  ADD COLUMN verification_stage profile_verification_stage NOT NULL DEFAULT 'unverified';

CREATE TYPE credential_type AS ENUM (
  'degree',                -- Bachelor's / graduation (BPT, BOT, BASLP, etc.)
  'postgraduate_degree',   -- Master's (MPT, MOT, MASLP, etc.)
  'council_registration'   -- Statutory registration OR professional association — see master_councils
);
ALTER TABLE credentials ALTER COLUMN type TYPE credential_type USING type::credential_type;
```

**`master_councils` — a small, hand-curated registry, deliberately not grown the same way as `master_institutions`.** Institutions are numerous and low-stakes to get slightly wrong (a curation-queue correction is cheap). Registering bodies are few, high-stakes, and — per real, reported fraud in this space — a target for fake "councils" that aren't legitimate registering bodies at all. Never auto-create a row here from OCR text alone, at any confidence score.

```sql
CREATE TYPE council_type AS ENUM ('statutory_registration', 'professional_association');

CREATE TABLE master_councils (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                          -- "NCAHP", "Telangana Para Medical Board", "IAP", etc.
  type council_type NOT NULL,
  state TEXT,                                  -- NULL for national bodies (NCAHP, IAP); set for state-specific councils/boards
  applicable_role role_needed_type,            -- nullable: some councils are role-specific, some cover multiple
  registration_number_pattern TEXT,            -- regex, per-council format — feeds the OCR scoring check in §8A2,
                                                -- which always assumed a per-council pattern existed but never
                                                -- had anywhere to store one until now
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE credentials ADD COLUMN council_id UUID REFERENCES master_councils(id);
```

**Pilot seed — three rows only, not a national list:**

| Council | `type` | `state` |
|---|---|---|
| Telangana Para Medical Board (TGPMB) | `statutory_registration` | Telangana |
| NCAHP | `statutory_registration` | NULL |
| IAP | `professional_association` | NULL |

**Confirm TGPMB's professional-registration function (not just paramedical course admissions) directly before seeding it** — this is faster to verify locally than from search, given the founder's own professional network. Same "confirm before curating" discipline §1C already states for a new profession's registering body, applied here to the pilot's actual launch state.

**Future states are curated on demand, not pre-populated.** When a therapist from outside Telangana signs up, their state council enters the same `pending_review` curation queue already built for institutions (§8B2) — admin verifies and approves before the row goes live, never auto-created. A hand-researched reference table covering all 36 states/UTs' current authorities exists outside this document as a curation aid for that future admin review — it accelerates verification, it does not substitute for it, since regulatory status in this space changes fast enough that a static list can't be trusted as current without a check at the time of use.

**[v19] Gating logic has exactly one writer.** v18 described the stage as "computed off approved `credentials` rows" while storing it as a column on `users` — two things that must agree, with no named mechanism keeping them in agreement. The expiry flow (§8A) made this concrete: it describes the badge being removed and referral claiming suspended after the grace period without ever saying which column changes, so an expired credential would leave `verification_stage = 'credentials_verified'` sitting in the database.

**The column is written by `recompute_verification_stage(user_id)` and nothing else** — a database function that derives the stage from the user's approved, unexpired `credentials` rows using the table below, called from exactly two places: the admin approve/reject action, and the credential-expiry job. No route, server action, or migration writes the column directly. This is what makes "only ever written by a human admin action" enforceable rather than merely intended, and it means the IAP-exclusion rule below is tested against one function instead of every caller. A nightly reconciliation query recomputes every active user's stage and alerts on drift.

**Gating logic, computed off approved `credentials` rows:**

| `verification_stage` | Requires | Unlocks |
|---|---|---|
| `unverified` | Nothing | Browse-only, per §8A3 |
| `qualification_confirmed` | ≥1 approved `credentials` row, `type IN ('degree','postgraduate_degree')` | Directory ranking tier between Verified and Unverified (§9); eligibility for institution/certification Communities (§8E3) — **not** referral claiming, **not** `patient_summary` access |
| `credentials_verified` | Additionally, ≥1 approved `credentials` row, `type = 'council_registration'`, joined to a `master_councils` row where `council_type = 'statutory_registration'` | Everything §8A3 currently gates at "verified" — unchanged |

**Hard rule, worth a dedicated test, not just a code comment:** a `council_registration` credential linked to a `professional_association`-type council (IAP) can be uploaded and displayed on the profile, but **cannot by itself trigger `credentials_verified`.** A council registration linked to *any* `statutory_registration`-type body does — this was never NCAHP-specific, and stays flexible as NCAHP enrollment grows over time. A therapist who later adds an NCAHP registration on top of an existing state-council one just gets a second `credentials` row — no re-verification from scratch.

**Sync rule, to avoid double data entry:** when a `degree` or `postgraduate_degree` credential is approved, auto-create a matching Tier 1 `course_completions` row so it appears under "Core Clinical Frameworks & Degrees" in the profile display (§8C3) — the therapist never re-enters their own degree a second time to make it show up there. `credentials` stays the single source of truth for verification gating; `course_completions` stays the single source of truth for what's displayed on the profile, synced one-way from the other, never the reverse.

---

### A2. Verification Pipeline — Auto-Triage, Never Auto-Approve

```
Upload → Signed R2 upload (private) → HTTP call to Google Cloud Vision
  (DOCUMENT_TEXT_DETECTION) → credentials.ocr_extracted_json
  → Confidence scoring (pg_trgm name similarity, registration-format check, expiry sanity)
  → Institution-name fuzzy match against master_institutions (§8B2, NEW in v18)
  → Admin queue, PRIORITISED BY SCORE — never auto-approved at any threshold
```

**OCR vendor: Google Cloud Vision, `DOCUMENT_TEXT_DETECTION` feature, single provider.** Scoped permanently to `credentials.document_url` (Tier 1/2 only) — never `course_completions.certificate_url`. Same GCP project already used for OAuth-adjacent services and Places.

**Cost: free tier is 1,000 units/month, non-expiring.** At Tier-1-only scoping (~2 units per therapist), this comfortably covers the pilot and the stated 500–1,000-therapist growth range. Past the free tier: $1.50 per 1,000 units — cheap enough that a multi-vendor pipeline to avoid it doesn't clear its own cost-benefit bar.

**Volume safety valve: a usage alert at ~750–800 units/month, not an automatic behaviour change.**

**Pre-launch validation:** run Vision against 15–20 real or representative Tier 1 documents — including deliberately poor phone photos — before relying on it.

- **Scoring:** name similarity (0–50), registration-number format match (0–30), expiry sanity (0–20).
- **Hard rule: the score sets queue priority and pre-fills the review screen. It never writes `credentials.status` or `users.verification_stage`.**
- OCR is fully async — the user never waits on it.

**Capacity model.** ~8–12 min per document with a good pre-filled review screen. At 30 signups/week that is 4–6 hrs/week for verification. **Total weekly ops** — verification + institution curation + empty-pool fallback calls + handover-deadline follow-up calls — is **10–15 hrs/week.**

---

### A3. Access Tiers — verification gates referral claiming

| Tier | Sees | Can do |
|---|---|---|
| No account | Public directory | — |
| Account, no credentials | Referral board: **specialty, locality, urgency, age only** | Browse |
| Credentials pending | Same + own queue status | Browse |
| **`qualification_confirmed`** *(NEW in v18, §8A1a)* | Same as pending | Browse; ranking tier between Verified and Unverified; eligible for institution/certification Communities (§8E3) — **still cannot** claim referrals or see `patient_summary` |
| **`credentials_verified`** | Full `patient_summary`, then contact on selection | **Express interest / be selected** |

**`patient_summary` is gated at `credentials_verified` specifically, not `qualification_confirmed` and not just the phone number.**

**Onboarding nudges:**
- Dashboard banner for `verification_stage = 'unverified'` or zero credential rows.
- Email drip: **T+3d** and **T+10d**, via `notifications`, with unsubscribe.

---

### A4. Invitations and Practice-Initiated Onboarding

```sql
invites (
  id UUID PRIMARY KEY,
  inviter_user_id     UUID NOT NULL REFERENCES users(id),
  inviter_practice_id UUID REFERENCES practices(id),
  code                TEXT NOT NULL,
  channel             TEXT,                             -- 'whatsapp' | 'copy_link' | 'sms'
  accepted_by_user_id UUID REFERENCES users(id),
  accepted_at         TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invites_by_inviter ON invites (inviter_user_id, created_at DESC);
CREATE INDEX invites_by_code    ON invites (code);
```

**Design rules:**
- Primary action is a **WhatsApp share deep link with a pre-filled message.**
- **No address-book access. No storage of invitee contact details.**
- Rate limit: **20 invites per user per week.**
- No invitation-funnel dashboard in v1 beyond a single "N joined via your invite" line on the profile.

**Practice-initiated onboarding:** a clinic manager **invites**; the therapist signs up themselves; the practice then sends an affiliation request the therapist accepts. **A practice never creates an account for a therapist.**

**No incentivized referral program — considered and rejected, not deferred.** "Invite N people, get X" style rewards were considered as a growth lever and rejected outright, not shelved for later. In a 25–30 person cohort where everyone will eventually know everyone, an incentivized invite mechanic reads as suspicious the moment someone notices a peer inviting them for a reward rather than genuine belief the platform is useful — and that suspicion travels fast and permanently in a small trusted community. It also tends to crowd out the exact intrinsic motivation invite-led cold start was chosen to preserve over seeding in the first place (§2). The invite mechanism stays exactly as specified — a private "N joined via your invite" stat, no reward layer, ever.

---

### B. Course & Certification Taxonomy

*(4-tier hybrid classification, `master_courses_certifications` + `course_completions` — unchanged.)*

`curation_status` is application-level logic, not a column default:
- `master_course_id IS NOT NULL` → `'approved'`
- `master_course_id IS NULL` → `'pending_review'` (enters the admin curation queue)

```sql
course_completions (
  id, user_id, master_course_id,
  custom_course_name, provider_name,
  duration_days DEFAULT 2,
  credit_hours NUMERIC(5,2),          -- nullable, unused in v1
  has_passed_exam BOOLEAN DEFAULT FALSE,
  calculated_tier, calculated_nomenclature,   -- system-computed, never user-editable
  certificate_url, completion_year,
  curation_status,
  deleted_at, created_at, updated_at
)
```

### B2. Institutions — NEW in v18, same curation pattern as course taxonomy

**Purpose: enable search-by-college (e.g. "Manipal," "NIMS") without hand-building a comprehensive list upfront** — the same reasoning that already rejected pre-seeding therapist profiles and rejected a hand-built country-wide college directory. Build it organically from real submissions instead.

```sql
CREATE TABLE master_institutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT,
  normalized_name TEXT,               -- lowercased, punctuation/suffixes stripped, for fuzzy matching
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX master_institutions_search ON master_institutions USING gin (normalized_name gin_trgm_ops);

ALTER TABLE credentials ADD COLUMN institution_id UUID REFERENCES master_institutions(id);
```

**How it populates:**
1. Tier 1 credential documents (degree certificates) almost always contain the institution name as part of what OCR already extracts (§8A2) — no new data collection from the therapist.
2. On submission, fuzzy-match the extracted or self-entered institution name against `master_institutions.normalized_name` (`pg_trgm` similarity — the same technique already used for legal-name matching).
3. **Match found** → `credentials.institution_id` links automatically.
4. **No match** → the free-text name enters the existing admin curation queue alongside course taxonomy, with the same two admin actions: link to an existing institution (typo/variant spelling) or add as new.

**Never auto-create an institution from an unreviewed match** — same discipline already applied to practice deduplication (§8C) and course curation: a fuzzy match is a suggestion for a human, not a decision.

**Directory/search filters on `institution_id`**, not free text (§9).

### B3. Practice Style — Modalities vs. Manual Therapy/Exercise

- `master_courses_certifications.category` gains `'electrotherapy_modalities'` — a category, not a `credential_tier` value.
- Machine/equipment lives on `practices.equipment_available JSONB` — clinic infrastructure, not a personal qualification.
- **The self-reported `users.practice_style` field is removed.**

---

### C. Practices — therapist-created, owner-claimed

**Any verified therapist can create a practice record; the owner later claims it with documentation.**

```sql
practices (
  id, name, type, slug,
  google_place_id, formatted_address, latitude, longitude,
  registration_number, verification_status,
  created_by_user_id,
  claim_status,                        -- 'unclaimed'|'claim_pending'|'claimed'|'disputed'
  claimed_by_user_id,
  claimed_at,
  possible_duplicate_of,
  noindex BOOLEAN NOT NULL DEFAULT true,
  logo_url, cover_image_url, bio,
  services_offered, specialties,
  equipment_available JSONB,
  website_url, phone, email,
  og_image_url, qr_code_url,
  deleted_at, created_at, updated_at
)

CREATE UNIQUE INDEX practices_unique_place
  ON practices (google_place_id)
  WHERE google_place_id IS NOT NULL AND deleted_at IS NULL;
```

**Deduplication.** `google_place_id` is the primary uniqueness key. A second dedupe path handles cases where Places has no listing or multiple pins:

```sql
ALTER TABLE practices
  ADD COLUMN normalized_name TEXT,
  ADD COLUMN normalized_address TEXT;
CREATE INDEX practices_dedupe_candidates
  ON practices (normalized_name, normalized_address) WHERE deleted_at IS NULL;
```

On creation, if `google_place_id` is absent OR a normalized name+address match exists within the same `area_id`, the record is created with `possible_duplicate_of` set and surfaced in the admin queue as a merge candidate. Never auto-merge.

**Field restrictions before a claim.**

| Therapist-created (unclaimed) | Owner-only (unlocked on claim) |
|---|---|
| Name, address (from Places), type | Bio, services offered, specialties, equipment |
| — | Phone, email, website |
| — | Logo, cover image |
| — | Managing affiliations, disputing affiliations |

**Unclaimed practice display rules:**
- No verification badge, no checkmark.
- Explicit label: *"Unclaimed listing — added by a therapist on AHP Network. Not verified."*
- **`noindex` until claimed.** No schema.org markup on unclaimed practices.
- A therapist creating a practice automatically receives a self-asserted `works_at` affiliation — never `owns`.

### C1. Practice claims

```sql
CREATE TYPE practice_claim_status AS ENUM (
  'submitted','under_review','query_raised','approved','rejected','withdrawn'
);

CREATE TABLE practice_claims (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id           UUID NOT NULL REFERENCES practices(id),
  claimant_user_id      UUID NOT NULL REFERENCES users(id),
  claimed_relationship  TEXT NOT NULL,          -- 'owner' | 'manager'
  document_url          TEXT NOT NULL,          -- private R2: registration, GST, trade licence
  registration_number   TEXT,
  status                practice_claim_status NOT NULL DEFAULT 'submitted',
  query_message         TEXT,
  reviewed_by_admin_id  UUID REFERENCES admin_users(id),
  reviewed_at           TIMESTAMPTZ,
  rejection_reason      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX practice_claims_one_open_per_claimant
  ON practice_claims (practice_id, claimant_user_id)
  WHERE status IN ('submitted','under_review','query_raised');
CREATE INDEX practice_claims_queue ON practice_claims (status, created_at);
```

**Google Business Profile cannot prove ownership.** Claims are proved the same way credentials are: **registration document upload + admin review**, reusing the §8A2 queue.

**Contested claims.** Application logic checks on insert: if `practices.claim_status` is already `'claim_pending'` when a new, different claimant's claim is submitted, both claims are recorded, `practices.claim_status` flips to `'disputed'`, the record freezes, and it escalates to admin review. Never resolve by first-come.

**On approval:** claimant gets `practice_users` with `access_role = 'owner'`, owner-only fields unlock, `noindex` clears, `claim_status = 'claimed'`.

### C2. Affiliations

```sql
practice_users (
  id, practice_id, user_id,
  access_role,          -- 'owner' | 'manager' | 'staff'
  relationship_type,    -- 'owns' | 'works_at' | 'visits'
  consent_status DEFAULT 'pending',   -- 'pending' | 'accepted' | 'declined'
  asserted_by,          -- 'self' | 'practice'
  disputed_at,
  disputed_by_user_id,
  is_public, display_title,
  ended_at, ended_by_user_id,
  deleted_at, created_at, updated_at
)
```

**Two directions, two consent models:**
- **Practice adds a therapist** (`asserted_by = 'practice'`) → `consent_status = 'pending'`, publicly visible only once the therapist accepts.
- **Therapist asserts their own workplace** (`asserted_by = 'self'`) → immediately visible.

**An owner claiming a practice cannot delete therapist-asserted affiliations.** They may set `disputed_at` / `disputed_by_user_id`, which routes to admin review.

**Affiliation independence stands.** A therapist's `home_visit_areas`, directory locality, and referral eligibility remain independent of practice affiliation.

### C3. Profile structures — therapist vs. practice

**Therapist profile (`/pt/[slug]`) — the credential is the subject.**

1. `display_name`, role, "Credentials Verified — [date]" badge
2. **Credentials block, given primary visual weight** — council, registration number, qualification tier, **institution (NEW: linked and searchable, §8B2)**
3. Core Expertise → Also Trained In → **Age groups served, as tags (NEW in v18 — `age_groups_served`, shown; `gender` is deliberately not on this list, filter-only per §8A)**
4. Courses grouped: Core Clinical Frameworks & Degrees → Workshops & Modality Certifications
5. Practice affiliations (accepted only), languages, home-visit areas
6. Availability: *"Available for new patients"* + freshness
7. Contact — direct, off-platform.
8. `schema.org/Person`

**Practice profile (`/clinic/[slug]`) — the place is the subject.**

1. Name, type, claim state
2. **Address and map, given primary visual weight**
3. Services offered, specialties, equipment (owner-only, absent when unclaimed)

**Decided this round: a practice profile never auto-derives or displays a "home visits" indicator from its affiliated therapists' `accepts_home_visits`.** Home-visit capability is a therapist-level fact (§8A), not a practice-level one — a practice card claiming "home visits" would overclaim, since the practice itself doesn't do home visits, specific affiliated therapists do. If an owner wants to mention it, that's ordinary free text in their own `services_offered` field (owner-only, §8C) — never a system-generated tag.
4. Affiliated therapists — accepted affiliations only
5. Hours, phone, website (owner-only)
6. `schema.org/MedicalBusiness`

**Verification wording must differ between them:** **"Credentials Verified — [date]"** for therapists, **"Ownership Verified — [date]"** for practices. Never the same badge component.

### C4. Practice-initiated staff onboarding

1. Manager sends an invite (§8A4).
2. Therapist signs up and creates their own profile.
3. Practice sends an affiliation request → `consent_status = 'pending'`, `asserted_by = 'practice'`.
4. Therapist accepts → publicly visible.

---

### D. Referral Board

**v1 scope: therapist- and practice-posted referrals only.** Public/patient referrals remain out of scope entirely (§8D2).

#### Structured posting fields — refined in v18

**`role_needed` and `specialization_needed` existed in v17 but were never defined as anything concrete, which meant they couldn't reliably drive a matching filter.** Both are now structured dropdowns, scoped to what's already defined elsewhere in this plan — not new scope:

```sql
CREATE TYPE role_needed_type AS ENUM ('physiotherapist','occupational_therapist','speech_language_pathologist');
CREATE TYPE specialization_type AS ENUM ('musculoskeletal_orthopaedic','neuro_rehab');
```

- `role_needed` → one of the three pilot professions (§1).
- `specialization_needed` → one of the two pilot specialties (§2). Extend this enum, not before, as §1C professions or new specialties are added.
- **`additional_context TEXT`, optional, NOT a matching filter.** Free text shown to the matched pool ("prefer someone comfortable with post-ortho cases," "caseload is full this month," etc.) — absorbs the intent a rejected `referral_reason` structured field would have covered, without forcing a taxonomy decision this early.
- **[v19] Visit type is a required, un-preselected choice at post time.** Both branches ship — a therapist with a full caseload referring a patient who will attend a clinic is a real case, not a scope error — but neither is the default. Same discipline §8D2 already applies to the consent checkbox, for the same reason: a pre-selected answer to a question that changes *who gets notified* is not really an answer. (The table keeps the name `home_case_referrals`; renaming touches every reference for no behavioural gain.)
- **`experience_level` is explicitly NOT a filter in the pilot.** Considered and rejected: at 25–30 therapists, adding another filter axis risks empty matched pools on specialties that already have thin coverage. Revisit only with real density data, same gating discipline already applied elsewhere.

#### Urgency

```sql
CREATE TYPE referral_urgency AS ENUM ('routine', 'urgent');
```

Set by the poster at post time. **"Urgent" means the patient needs to start soon, not a medical emergency** — shown live beside the field.

```sql
ALTER TABLE home_case_referrals ADD COLUMN urgency_reason TEXT;
-- required when urgency = 'urgent'; visible to admins only, never to the matched pool
```

**No hard rate cap in v1** — 30-ish people who know each other is a social check. **Revisit at ~200 therapists.**

#### Contact mode — **relay only in the pilot**

```sql
CREATE TYPE contact_mode AS ENUM ('direct', 'relay');
ALTER TABLE home_case_referrals
  ADD COLUMN contact_mode contact_mode NOT NULL DEFAULT 'relay';
```

**The pilot ships relay only.** Direct mode is fully specified here and its columns exist, but no UI offers it and `contact_ack_deadline_at` remains NULL throughout.

**Relay:** the platform never collects the patient's phone number. On acceptance, the **accepting therapist's own listed contact details** are shared with the poster, who passes them to the patient off-platform (§9). No `contact_reveals` row for the patient side.

**Direct mode (dormant — do not build in v1):** patient contact details encrypted at rest per §5's envelope, revealed to the accepting therapist via `contact_reveals`, with `contact_ack_deadline_at` governing the contact window and rerouting on lapse. Build only when poster-reported completion data (§11) shows relay is insufficient, and only after §15A addresses the consent question.

```sql
CREATE TABLE home_case_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open','shortlisted','accepted','contact_acknowledged',
               'completed','cancelled_by_poster','expired')
  ),
  urgency referral_urgency NOT NULL DEFAULT 'routine',
  contact_mode contact_mode NOT NULL DEFAULT 'relay',
  posted_by_user_id, posted_by_practice_id, posted_by_type,
  role_needed role_needed_type NOT NULL,                    -- NEW in v18: structured, not free text
  specialization_needed specialization_type NOT NULL,        -- NEW in v18: structured, not free text
  additional_context TEXT,                                   -- NEW in v18: optional, never a filter
  home_visit_required BOOLEAN NOT NULL,                      -- NEW in v18: drives visit-type matching below.
                                                             -- [v19] DEFAULT false REMOVED. With a default, a referral
                                                             -- posted without touching this field was a clinic referral
                                                             -- — a column default quietly answering a product question
                                                             -- in a product whose premise is home-based care. The poster
                                                             -- now chooses explicitly; see the posting rule below.
  location_address, area_id,
  patient_summary,                                            -- see §8D2 for the v18 UI guardrail on this field
  patient_consent_recorded_at,
  consent_text_version,
  shortlist_closes_at,                                        -- [v19] given a rule in the timing table below;
                                                              -- declared but undefined in v18
  offer_expires_at,
  contact_ack_deadline_at,                                    -- DIRECT MODE ONLY; NULL for the entire pilot
  confirm_deadline_at,
  expiry_stage TEXT NOT NULL DEFAULT 'none' CHECK (            -- [v19] declared but never defined in v18.
    expiry_stage IN ('none','pool_expanded','admin_alerted','close_prompted')
  ),                                                          -- mirrors the escalation ladder in the
                                                              -- empty-pool fallback and timing sections
  reroute_count INT NOT NULL DEFAULT 0,
  matched_pool_size_at_post INT,
  matching_algorithm_version TEXT NOT NULL DEFAULT 'v1',      -- NEW in v18: freezes matching logic for analytics
  extended_once BOOLEAN NOT NULL DEFAULT false,
  accepted_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE referral_interest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id UUID NOT NULL REFERENCES home_case_referrals(id),
  therapist_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    -- [v20] 'declined' added (§G2): a therapist actively saying "can't take
    -- this one" is a different fact from the window closing unanswered
    -- ('missed'). Conflating them leaves the poster unable to tell
    -- disinterest from unavailability, and leaves the therapist no honest
    -- answer except ignoring a push. TEXT + CHECK per CLAUDE.md's
    -- convention, so adding this value migrates inside a transaction.
    status IN ('pending','shortlisted','accepted','not_selected','withdrawn','missed','declined')
  ),
  shortlisted_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)

CREATE TABLE contact_reveals (
  -- DORMANT for the entire pilot — applies to contact_mode = 'direct' only.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id UUID NOT NULL REFERENCES home_case_referrals(id),
  revealed_to_user_id UUID NOT NULL REFERENCES users(id),
  revealed_data JSONB NOT NULL,
  ip_address INET,
  consent_timestamp TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TYPE notification_outbox_status AS ENUM ('pending','sent','failed');

CREATE TABLE notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL CHECK (channel IN ('push','email')),
  template TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status notification_outbox_status NOT NULL DEFAULT 'pending',
  attempt_count INT NOT NULL DEFAULT 0,
  last_attempted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notification_outbox_pending ON notification_outbox (status, created_at) WHERE status = 'pending';

-- [v19] Claim, dedupe, and backoff. v18's table had attempt_count but nothing that read it,
-- no claim mechanism, and no dedupe key — so any overlapping cron run or retry produced
-- duplicate sends. In a 25–30 person cohort a double push notification is noticed immediately.
ALTER TABLE notification_outbox
  ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN locked_at       TIMESTAMPTZ,
  ADD COLUMN dedupe_key      TEXT;
CREATE UNIQUE INDEX notification_outbox_dedupe
  ON notification_outbox (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notification_outbox_claimable
  ON notification_outbox (next_attempt_at) WHERE status = 'pending';
```

**[v19] The worker claims with `SELECT ... FOR UPDATE SKIP LOCKED`**, sends, then marks `sent` or sets `next_attempt_at` on an exponential backoff. `dedupe_key` is set by the enqueuing transaction (e.g. `shortlist:{referral_id}:{user_id}`) so a retried transaction cannot enqueue the same notification twice. **[v19] `notifications` (§8G) and `notification_outbox` were two write paths for one concern in v18** — the outbox is now the single write path for everything that sends; `notifications` is retained only as a user-facing history populated from it, if that history is wanted at all.

#### Matching model: targeted filter, then a shortlist race

**Step 1 — targeted notification (refined in v18).** v17 never specified how wide the initial notification actually went — this closes that gap. A posted referral notifies only therapists matching **all** of:
- `role_needed` matches their `role` **[v19] (`users.role`, typed `role_needed_type` — a plain equality)**
- **[v19] `specialization_needed = ANY(users.specializations)`.** v18 said "is among their skills/expertise," which had no queryable field behind it — `therapist_skills.skill_name` is free text and `course_completions` is a display taxonomy. `users.specializations` (§8A) is the only matching input; never match against either of those two.
- `area_id` matches (or falls within) their `home_visit_areas`
- `accepting_referrals = true`
- **Visit-type match:** if `home_visit_required = true`, only `accepts_home_visits = true` therapists are notified; if false, only `accepts_clinic_visits = true` therapists are notified. A therapist accepting both gets notified either way.

This is a plain SQL filter — **no scoring engine, no configurable weights.** At 25–30 pilot therapists that's the entire matching system needed; a weighted-scoring approach was considered and rejected as complexity ahead of the density that would make it meaningful. `matching_algorithm_version = 'v1'` is stored on the referral so this can evolve later without corrupting historical `matched_pool_size_at_post` analytics.

**Step 2 — shortlist race, in plain terms: the poster picks up to 2 finalists, whoever accepts first gets the case, and nobody sees patient details until they say yes.**

- Anyone in the matched pool can tap **"I'm interested"** — this only registers interest, reveals nothing.
- The poster shortlists **up to 2** interested therapists in one action. Both notified simultaneously with *"Offered to you — accept?"* — still no patient name or phone number, only specialty/locality/urgency, until one of them accepts.
- **First to accept gets it.** The other's offer closes immediately. Only on acceptance are the accepting therapist's own contact details shared with the poster.
- **[v20] The closing message to the therapist who didn't win does a small amount of emotional work** (§G3): *"[Name] accepted this one first — you were one of 2 chosen out of N interested."* Both numbers already exist. v19's bare *"Went to someone else"* is accurate and reads as losing a buzzer race; being shortlisted at all is a compliment from a peer, and in a cohort where everyone will meet in person, that framing is the difference between the race feeling fair and feeling like a game show.
- Two shortlist slots, not more — every extra person notified and not chosen has a real social cost in a small community.
- **[v20] The poster is told the rules before they commit, not after** (§G4): the shortlist screen states that they may pick **up to 2**, that **whoever accepts first gets the case**, and that the choice **cannot be changed for 30 minutes (urgent) / 1 hour (routine)** — the hold already specified under "Poster controls before a match." A one-way action with a cooling-off period must not be discovered by taking it.

**Confirmed, permanently — this is the product's reason to exist, not a v1 placeholder.** *(Reconsidered in this revision against a proposal to revert to sequential selection; rejected — see §0.)* First-claim-wins does not exist in this codebase.

```sql
CREATE UNIQUE INDEX referral_one_accepted
  ON referral_interest (referral_id)
  WHERE status = 'accepted' AND deleted_at IS NULL;

CREATE UNIQUE INDEX referral_one_active_interest_per_therapist
  ON referral_interest (referral_id, therapist_user_id)
  WHERE status IN ('pending','shortlisted','accepted') AND deleted_at IS NULL;
```

**Shortlisting is a row-locked transaction over EXISTING interest rows, not an insert.** Bulk `UPDATE` of `pending` rows, lock held for the whole check-and-write:

```sql
-- [v19] This is the body of shortlist_referral(), invoked by the app as a single
-- SELECT shortlist_referral($1,$2,$3) statement — not a script the app runs statement by
-- statement. See "Transaction form" below.
BEGIN;
SELECT id FROM home_case_referrals WHERE id = $1 FOR UPDATE;

SELECT count(*) FROM referral_interest
  WHERE referral_id = $1 AND status = 'shortlisted' AND deleted_at IS NULL;
-- [v19] inside the function: RAISE (rolling back the whole call) if existing_count + array_length(chosen_ids,1) > 2

UPDATE referral_interest
  SET status = 'shortlisted', shortlisted_at = now()
  WHERE referral_id = $1
    AND therapist_user_id = ANY($2::uuid[])
    AND status = 'pending'
    AND deleted_at IS NULL;
-- [v19] inside the function: assert ROW_COUNT = array_length(chosen_ids,1); on mismatch RAISE,
-- which rolls back the whole call — never partially shortlist. The caller maps that condition
-- to "one of your choices is no longer available, pick again"

-- [v19] CORRECTED. v18 read "INSERT INTO home_case_referrals ... SET offer_expires_at = ..." —
-- malformed, and it never wrote status. Since accept (below) rejects anything not still
-- 'shortlisted', implementing v18 verbatim meant every accept in the system rolled back.
UPDATE home_case_referrals
   SET status = 'shortlisted', offer_expires_at = $3, updated_at = now()
 WHERE id = $1;
INSERT INTO referral_events (referral_id, event_type, actor_user_id, payload)
  VALUES ($1, 'shortlisted', $poster_id, jsonb_build_object('therapist_ids', $2));
COMMIT;
-- Notifications enqueued here, not sent inline — see notification_outbox above.
```

**Accept is a full transaction** — winner update, sibling close-out, referral status update, event insert, all in one commit:

```sql
-- [v19] Body of accept_referral(), invoked as a single statement. The idempotency-key check
-- happens here, inside the function, before anything below runs.
BEGIN;
SELECT id, status FROM home_case_referrals WHERE id = $1 FOR UPDATE;
-- reject if status is not still 'shortlisted'

UPDATE referral_interest SET status = 'accepted', responded_at = now()
  WHERE id = $2 AND referral_id = $1 AND status = 'shortlisted'
  RETURNING id;
-- zero rows ⇒ the OTHER shortlisted therapist already accepted first. [v19] RAISE to roll back
-- the whole call; the caller maps that condition to "went to someone else."

UPDATE referral_interest SET status = 'not_selected'
  WHERE referral_id = $1 AND status = 'shortlisted' AND id != $2;

UPDATE home_case_referrals
  SET status = 'accepted', accepted_at = now(),
      confirm_deadline_at = ...
  WHERE id = $1;

INSERT INTO referral_events (referral_id, event_type, actor_user_id)
  VALUES ($1, 'accepted', $accepting_therapist_id);
COMMIT;
```

#### [v19] The offer-lapse transaction — the third one, unspecified in v18

`referral_interest.status = 'missed'` is described in prose below ("On a missed offer") but v18 gave no transaction that writes it. It needs one, with the same rigor as the other two: the deadline scheduler runs sub-hourly and a therapist can accept at any moment, so **the lapse job and a live accept can fire against the same referral in the same second.** If lapse wins that race carelessly, it closes an offer that was just accepted.

```sql
-- lapse_offers(referral_id)
SELECT id, status FROM home_case_referrals WHERE id = $1 FOR UPDATE;
-- if status <> 'shortlisted', the accept already won (or the poster withdrew): no-op, commit, return.

UPDATE referral_interest SET status = 'missed', responded_at = now()
  WHERE referral_id = $1 AND status = 'shortlisted' AND deleted_at IS NULL
    AND now() >= (SELECT offer_expires_at FROM home_case_referrals WHERE id = $1);

-- If any shortlisted interest remains (the other offer hasn't lapsed yet), leave the referral
-- 'shortlisted' — per "Two shortlisted, one lapses → the other's offer stands untouched."
-- If none remains, return the referral to 'open', increment reroute_count, and enqueue the
-- poster's "Missed — choose someone else" notification.
```

A `missed` interest can never be re-selected on that referral, including after a repost — enforced in application logic on the shortlist path, since the partial unique index on `referral_interest` deliberately excludes terminal statuses.

#### [v19] Transaction form: PL/pgSQL functions, one statement each

**All three transactions above — shortlist, accept, lapse — are PL/pgSQL functions in hand-written SQL migrations, each invoked as a single `SELECT fn(...)` statement.** The SQL written out above is the body of each function, not a script for the application to execute statement by statement.

```
shortlist_referral(referral_id, poster_id, therapist_ids[])                → jsonb
accept_referral(referral_id, interest_id, therapist_id, idempotency_key)   → jsonb
lapse_offers(referral_id)                                                   → jsonb
```

Each takes the `FOR UPDATE` on `home_case_referrals` as its serialization point, performs its rowcount assertions, writes `referral_events` and `notification_outbox` in the same atomic unit, and raises a named condition to roll back — which the caller maps to the display wording below. **Never re-implement any of them as a sequence of client-side queries or a wrapped `db.transaction()`.** See §7 for why this form was chosen: a single statement is atomic under any pooling mode, which is what makes Hyperdrive safe here and removes the need for a second connection path.

#### [v19] Idempotency storage

The accept endpoint's required idempotency key had nowhere to live in v18.

```sql
CREATE TABLE idempotency_keys (
  key           TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id),
  endpoint      TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response_json JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**The check happens inside `accept_referral()`, not in front of it** — a key checked outside the transaction is not a guard against the race it exists to prevent. A repeated key returns the stored response rather than re-entering the transaction. Purge at 30 days.

**Required invariant tests, asserted under real concurrent load:**
- No referral ever holds more than 2 `shortlisted` interests.
- No referral is ever `accepted` by more than one therapist.
- Every `accepted` referral has at most one `shortlisted` sibling, always `not_selected`, never dangling.
- **[v19]** A lapse and an accept firing simultaneously on one referral never both succeed, and never leave an accepted referral with a `missed` winner.
- **[v19]** A repeated accept with the same idempotency key produces one accept and one stored response, not two attempts.

**[v19] What this depends on (§7):** not a pooling mode — the function form makes pooling mode irrelevant. What must be verified instead is that **no referral state transition has been re-implemented as client-side statements.** That is now the failure condition, and it is a code-review and test concern rather than an infrastructure one.

**Re-expressing interest after a repost — [v20] RELAXED, see §G2.** A `withdrawn` interest MAY re-express interest on a repost. **A `missed` interest MAY ALSO re-express interest on a repost.** v19 barred this permanently; that rule punished exactly the behaviour this product is built around — a therapist with their hands on a patient for two hours cannot answer a 2-hour offer window, and locking them out of that case forever (even after a repost) creates a real resentment source in a 25–30 person cohort where everyone meets in person. The poster still sees that the offer previously lapsed, so the information isn't lost; the door simply isn't bolted.

**Schema note:** `referral_one_active_interest_per_therapist` covers only `('pending','shortlisted','accepted')`, so a `missed` row does not block a fresh `pending` row for the same `(referral_id, therapist_user_id)` — this relaxation needs no index change.

**[v20] Declining is an explicit action, distinct from missing.** A therapist who cannot take an offer taps **"Can't take this one"**, which resolves their interest to `declined`. `missed` then means only "the window closed without an answer," never "they said no." Without this split, the poster cannot tell disinterest from unavailability, and the therapist has no way to answer honestly except by ignoring a push.

**Notification delivery — transactional outbox, not inline sends.** Every state-changing transaction writes to `notification_outbox` in the same transaction; a separate worker polls and sends.

#### Timing — scaled by urgency

| | Routine | Urgent |
|---|---|---|
| **[v19] Shortlist window (`shortlist_closes_at`)** — how long the poster has to shortlist before the referral is auto-prompted for close or repost | **7 days from post** | **24 hours from post** |
| Offer acceptance window (`offer_expires_at`) | 4 working hours | **2 working hours** |
| Poster confirmation prompt (`confirm_deadline_at`) | 24–48 hours | **12 hours** |
| *Contact-acknowledgement — direct mode only, dormant in pilot* | *4 working hours* | *2 working hours* |
| No interest → parent-zone expansion | 48h | **4h** |
| No interest → admin alerted | 5 days | **8h** |
| Auto-close prompt to poster | 14 days | **48h** |

All working-hours windows computed against 08:00–21:00 IST. **[v19] The working-hours arithmetic is a single pure function with its own unit tests** — every deadline in this table depends on it, it is trivially wrong across midnight and weekends, and it is the kind of thing that fails silently by producing a plausible-looking wrong timestamp. **The deadline scheduler must run on a real sub-hourly cadence** — a daily cron job cannot service a 2-hour urgent window; this is a P0 requirement, not an open question (see §13's P0 table).

**[v20] These seven timers exist internally; at most TWO are ever visible to a user. See §G1.** Every row above stays as scheduler behaviour — the table is unchanged as an engineering spec. What changes is the surface:

| Timer | User-visible? |
|---|---|
| Offer acceptance window | **Yes** — a live countdown, to the receiving therapist only. The one clock that gates an action they must take. |
| Everything else the poster is subject to | **No countdown.** The poster sees a single plain-language "what happens next" line for the referral's current state (the §8D display-wording table below), never a timer. |
| Zone expansion · admin alert · auto-close · shortlist window | **No user notification at all** — these fire as *admin* tasks (an item in the ops queue, a call from the founder), exactly as the "after 2 reroutes → human calls" rule already does. |

**Why:** a poster who lists one case and is nudged by three different clocks inside 48 hours experiences the product as nagging, not helping — and at 25–30 users a human following up is both warmer and cheaper than a notification ladder. This is a deliberate trade of automation for touch at pilot scale; revisit when volume makes the calls impractical, not before. **Poster-facing nudges are capped at one per referral per 24 hours regardless of how many internal timers fire.**

#### On a missed offer

- **Two shortlisted, one lapses** → the other's offer stands untouched.
- **Both lapse, or only one was shortlisted and it lapsed** → poster gets a push: *"Missed — choose someone else,"* with remaining interested therapists one tap away.
- **After 2 reroutes** on one referral → stop cycling, escalate to the admin queue, human calls.
- A lapsed therapist's interest moves to `missed`. **[v20]** They may re-express interest on a repost (§G2 above) — `missed` records what happened, it is not a permanent bar.

**Relay mode does not reroute after acceptance.** A relay referral that stalls after acceptance **nudges the poster**, it does not reshuffle therapists.

#### Poster controls before a match

- **Nudge** — available immediately.
- **Withdraw and re-shortlist** — available after a minimum hold: **30 minutes urgent, 1 hour routine.**

#### Referral events — extended in v18

```sql
CREATE TABLE referral_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id   UUID NOT NULL REFERENCES home_case_referrals(id),
  event_type    TEXT NOT NULL,     -- 'posted','notification_dispatched','referral_viewed',
                                   -- 'interest_expressed','shortlisted','accepted',
                                   -- 'offer_lapsed','poster_confirmed','reposted','closed'
  actor_user_id UUID REFERENCES users(id),
  payload       JSONB NOT NULL DEFAULT '{}',   -- no patient-identifying data, ever
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX referral_events_by_referral ON referral_events (referral_id, created_at);
```

**Two event types added in v18:**
- **`notification_dispatched`** — logged when the matched pool is notified: `referral_id`, which therapists were notified, channel, timestamp. Makes "posted → notified" a real interval.
- **`referral_viewed`** — logged on **first** view only per therapist (not every reopen, to avoid noise): `referral_id`, `therapist_user_id`, timestamp. Makes "posted → first relevant response" — the single most important funnel number for proving TheraNet beats a WhatsApp broadcast — a real query.

**Current state is NOT derived by replaying events.** `home_case_referrals.status` remains the source of truth; this table is for reconstructing what happened.

#### On expiry

> *"Still need someone for this?"* → **Extend 7 days** · **Repost as new** · **Close**

**Repost is the prominent option.** **Extensions cap at one.**

#### The most valuable signal the system produces

**An urgent referral nobody accepts is a named, dated, located instance of unmet demand.** §12's ops dashboard gains a dedicated view: **Unserved urgent referrals** — zone, specialty, `matched_pool_size_at_post`, time open.

#### Display wording — plain language, not the internal enum

| Internal state | Poster sees | Receiving therapist sees |
|---|---|---|
| `open`, no interest yet | **Posted** — Waiting for responses | **Open** — Near you |
| interest exists, not shortlisted | **N interested** — Tap to choose | **Interested** — Awaiting their decision |
| `shortlisted` | **Offered** — Sent to [name] | **Offered to you** — Accept within [2h/4h] |
| `accepted` (relay — the pilot path) | **Share details** — Give your patient [name]'s number | **Accepted** — Your details have been shared |
| awaiting poster confirmation | **Did they connect?** — Yes / didn't work out | **Accepted** — Awaiting confirmation |
| *`accepted`, direct mode (dormant)* | *Accepted — [name] is calling the patient* | *Call the patient — within [2h/4h]* |
| `completed` | **Done** | **Done** |
| rerouted, sibling lost the race | **Rerouted** — Now with [name] | **[v20]** *"[name] accepted this one first — you were one of 2 chosen out of N interested."* (§G3) |
| **[v20]** offer window closed unanswered (`missed`) | **No answer** — [name] didn't respond in time | **Offer expired** — you can still express interest if it's reposted (§G2) |
| **[v20]** therapist actively declined (`declined`) | **Declined** — [name] can't take this one | **Declined** — you told them you can't take this one |
| `expired` | **Closed** — No responses | — |

#### Empty matched-pool fallback

Zero matches → expand to the parent zone via the `areas` hierarchy (4h urgent / 48h routine) → admin notified if still empty (8h urgent / 5 days routine). `matched_pool_size_at_post` must exist from day one.

### D2. Patient Consent on Therapist-Posted Referrals

**Patient-originated referrals are out of scope.** No intake form, no public request page, no admin conversion flow. Revisit only with counsel engaged.

**Patient data flows through the platform only in `contact_mode = 'direct'`.** In **relay mode** (the default), the platform never collects the patient's phone number.

**Patient-summary field guardrail — new in v18.** `patient_summary` is free text with no structural way to prevent a therapist from typing identifying details into it, which would quietly defeat the entire relay-only privacy design. Two cheap additions, no schema change:
- **Placeholder text in the field itself**, showing the right pattern before anyone types anything: *"e.g. 65M, s/p knee replacement, needs regular home PT"* — age, sex, condition/procedure, care need.
- **A short inline warning above the field:** *"Don't include name, phone number, or exact address — just age, condition, and care need."*

Mandatory consent checkbox, un-prechecked, blocks referral creation:

> ☐ *I confirm I have my patient's consent to share their contact details and care requirements with another therapist on this platform for the purpose of arranging a referral.*

**One checkbox, not several.** Final wording is counsel's (§15A).

- `home_case_referrals.patient_consent_recorded_at` remains **`NOT NULL`** on transition into `open`, regardless of contact mode.
- `consent_text_version` records the exact wording agreed to. Bump on every change, including placeholder iterations.
- Consent copy ships as `"[DRAFT — pending legal review]"` until §15A completes.

**Scope note for the Network Activity feed (§9, NEW in v18):** the consent checkbox above is written for the matched-pool audience. The platform-wide activity feed exposes only the structured fields (specialty, urgency, zone, age bracket) — **never `patient_summary` free text** — to keep this inside the existing consent wording without needing a broader disclosure. If the free-text summary is ever surfaced more broadly than the matched pool, that's a distinct consent-wording change requiring its own counsel review, not something to ship quietly.

**Admin role in referrals is narrow.** Admins do not create, convert, moderate, or assign referrals.

### E. Blog — **deferred** (see §13)

### E2. Circles — **P1, deferred past pilot, specified in full in v18**

**Concept: "people I want to remember" — a private, live address book.** Therapists save profiles into personal, named lists ("Trusted Home-Visit Therapists," "Neuro Referrals"). This is a structured version of the already-deferred `bookmarks` feature (§13) — same feature, given named-list organisation rather than one flat list.

**Navigation placement, decided this round: Circles does not share a tab with Communities.** They were initially sketched together under one "Communities" tab label during a mockup pass, but that pairing is genuinely confusing — Circles is private and silent, Communities is public and opt-in, and a tab literally labeled "Communities" containing a private tool you're not meant to treat as social sends the wrong signal on first open. Circles lives inside the therapist's own Profile/settings area instead, since it's a personal tool, not a networking surface — Communities keeps its own top-level tab.

```sql
CREATE TABLE circles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE TABLE circle_members (
  circle_id UUID NOT NULL REFERENCES circles(id),
  therapist_user_id UUID NOT NULL REFERENCES users(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_id, therapist_user_id)
);
-- No consent_status, no notification on insert, by design.
```

**Privacy: 100% silent.** Added professionals receive no notification, see no counter, cannot view who added them or that they were added. This is a hard rule, not a default — a Circle is the owner's private tool, never a signal to the person listed.

**Future utility — targeted referrals, P1/P2, not pilot scope.** A referral can eventually be restricted to a Circle instead of the open matched pool, extending `home_case_referrals` rather than touching the state machine itself:

```sql
ALTER TABLE home_case_referrals
  ADD COLUMN targeting_mode TEXT NOT NULL DEFAULT 'open_matched_pool'
    CHECK (targeting_mode IN ('open_matched_pool','circle_restricted','community_restricted')),
  ADD COLUMN target_circle_id UUID REFERENCES circles(id),
  ADD COLUMN target_community_id UUID REFERENCES communities(id);
```

Two decisions required before this is built, not yet made:
1. **Fallback behaviour** if a Circle- or community-restricted referral gets no response — reuse the existing empty-pool-fallback timing (§8D) rather than invent new logic, unless the poster explicitly marks it restricted-only.
2. **Exclude restricted referrals from "unserved urgent" ops metrics** (§12) — a Circle of 3 that doesn't respond is a poster's private choice, not a supply-gap signal, and must not be counted as one.

**Access-tier rule, unconditional:** Circle membership can only narrow *within* who's already eligible under §8A3's access tiers — it is never a mechanism to route `patient_summary` to someone who wouldn't otherwise pass verification gating.

### E3. Communities — **deferred, gated at ≥100 verified active therapists per city, specified in full in v18**

**Concept: "professional spaces I participate in" — opt-in, asynchronous, structured hubs.** Deliberately **not** real-time chat, DMs, or a continuous message feed — every mechanism below is built to keep this a bulletin board with a pulse, not a WhatsApp clone.

**Four origin types — different creation, membership, and posting models, kept distinct rather than treated as one generic mechanism:**

| Type | Created | Membership | Who posts |
|---|---|---|---|
| **Platform-curated** | Manually, by AHP Network (e.g. "Hyderabad AHPs") | Opt-in join | Admin, freely |
| **Institution** *(auto-generated)* | Weekly job, once ≥5 verified therapists share an institution | Recommended on credential verification, one-tap opt-in — **never auto-enrolled** | Any member submits; publishes immediately if posted by an approved community moderator or admin, otherwise enters `pending_review` |
| **Certification** *(auto-generated)* | Same mechanism, scoped to a short, admin-curated allow-list of **internationally recognised certifications only** — bodies with a genuine international accrediting institute (Mulligan, Maitland, McKenzie/MDT, Cyriax, PNF, Bobath/NDT, Barral), not a popularity-based cutoff | Same as institution | Same as institution |
| **Workplace** *(auto-generated)* | Weekly job, once a practice is `claimed` **and** has ≥2 accepted affiliations | **Auto-enrolled** — the one exception, because affiliation acceptance is already a public disclosure via `practice_users`; membership is computed live, never duplicated | Practice owner/manager (`practice_users.access_role`), freely |
| **User-created** | A verified member proposes one | Same `pending_review` curation queue as institution/course curation before it exists at all | Creator, once approved |

```sql
CREATE TYPE community_type AS ENUM ('platform_official','user_created');
CREATE TYPE community_status AS ENUM ('active','pending_review','closed');

CREATE TABLE communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  area_id UUID REFERENCES areas(id),                      -- nullable: some communities aren't locality-bound
  specialization specialization_type,                      -- nullable, reuses §8D's enum
  type community_type NOT NULL DEFAULT 'platform_official',
  status community_status NOT NULL DEFAULT 'active',
  origin TEXT NOT NULL DEFAULT 'platform_curated'
    CHECK (origin IN ('platform_curated','auto_generated_institution',
                       'auto_generated_certification','auto_generated_practice','user_created')),
  source_institution_id UUID REFERENCES master_institutions(id),
  source_course_id UUID REFERENCES master_courses_certifications(id),
  source_practice_id UUID REFERENCES practices(id),
  -- exactly one of source_institution_id / source_course_id / source_practice_id
  -- set when origin is auto_generated_*; all NULL for platform_curated / user_created
  created_by_user_id UUID REFERENCES users(id),            -- NULL for platform- and auto-generated
  reviewed_by_admin_id UUID REFERENCES admin_users(id),    -- user_created only
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE community_members (
  community_id UUID NOT NULL REFERENCES communities(id),
  user_id UUID NOT NULL REFERENCES users(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);
-- Used for platform-curated, institution, certification, and user-created communities.
-- NOT used for workplace communities — see the view below.

-- Workplace membership is never stored — it's derived live from practice_users,
-- so a therapist leaving a practice automatically falls out of the community in
-- the same transaction, with nothing to keep in sync.
CREATE VIEW practice_community_members AS
SELECT c.id AS community_id, pu.user_id
FROM communities c
JOIN practice_users pu ON pu.practice_id = c.source_practice_id
WHERE c.origin = 'auto_generated_practice'
  AND pu.consent_status = 'accepted'
  AND pu.ended_at IS NULL
  AND pu.deleted_at IS NULL;
```

**Auto-generation mechanics, all three sources:**
- Runs as a **weekly job**, alongside the ones already planned for nudges and purges (§8A3, §8H) — no new infrastructure category.
- Reads only against data already curated once — `master_institutions`, the certification allow-list, `practice_claims`/`practice_users` — never re-reviews already-approved names.
- **Density-gated before a shell is created at all**, same discipline as every other density gate in this plan (§2, §8F): below the threshold, the person sees a private stat only (*"4 other Manipal grads on the network"*), with no joinable shell yet. This avoids the exact empty-hub problem §8F already named for vacancies.
- On acceptance of a practice affiliation, add one disclosure line so auto-enrolment is never a silent surprise: *"You'll also appear in [Practice]'s workspace on AHP Network."*
- If a workplace community's practice becomes unclaimed or drops below 2 affiliations, the community goes dormant (soft-deactivated, not deleted), consistent with how the rest of the plan treats reversible state.

**Moderation — institution and certification communities only** (workplace and platform-curated already have an accountable owner; see the table above):

```sql
CREATE TABLE community_moderators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','revoked')),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by_admin_id UUID REFERENCES admin_users(id),
  reviewed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by_admin_id UUID REFERENCES admin_users(id)
);
CREATE UNIQUE INDEX community_moderators_one_active
  ON community_moderators (community_id, user_id) WHERE status IN ('pending','approved');
```

- Any verified member can **apply**; an admin approves — reusing the same self-nomination-plus-admin-approval shape already used for practice claims, not a new pattern.
- **Multiple moderators per community, not an exclusive single seat** — several trusted members sharing light moderation load, rather than one high-stakes appointment.
- **Revocable by `super_admin`, never re-votable.** Voting was considered and rejected outright — real ballot/quorum/removal infrastructure this scale doesn't need, and gameable by a handful of coordinated members in a small community. Auto-appointing current faculty was also considered and rejected — it fails consent (appointing someone to a role is a bigger grant than membership) and there's no built pipeline to verify who currently holds a teaching post.
- **Scoped narrowly and kept entirely outside `admin_user_roles` (§8G5):** a community moderator can approve or reject posts in that one community only — no platform verification-queue visibility, no admin-mode access, no proximity to patient contact data.
- **Not a bootstrapping requirement.** Before any moderator is approved, member-submitted posts simply sit in the same central admin curation queue used for institution/course curation — nothing is blocked, moderators are a scaling relief valve as a community grows.

**Posting — three structured types, nothing else:**

```sql
CREATE TYPE community_post_type AS ENUM ('announcement','resource','event');
CREATE TYPE community_post_status AS ENUM ('pending_review','published','removed');

CREATE TABLE community_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  posted_by_user_id UUID NOT NULL REFERENCES users(id),
  type community_post_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,                                                 -- resource links only
  status community_post_status NOT NULL DEFAULT 'published',
  -- Owned communities (workplace, platform-curated): defaults to 'published'.
  -- Unowned communities (institution, certification): application logic forces
  -- 'pending_review' on insert unless posted_by holds an approved moderator
  -- grant or admin role for this community.
  reviewed_by_admin_id UUID REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX community_posts_feed ON community_posts (community_id, created_at DESC) WHERE status = 'published';
```

| Type | What it is | Example |
|---|---|---|
| **Announcement** | One-way notice from whoever has standing to speak for the community | *"Clinic closed for Diwali, Oct 20–22"* |
| **Resource** | A link or reference worth surfacing | *"NIMS free CE webinar on vestibular rehab — link inside"* |
| **Event** *(P1 generally; P0 for the founding-cohort community only — see below)* | Single bulletin listing — date, time, location. No RSVP, no capacity, no ticketing | *"Mulligan Concept refresher, Hyderabad, 14 Dec"* |

**Explicitly excluded, by schema design, not just convention:** no reply threads, no comments, no open-ended discussion posts, no read receipts, no "who's going" on events. `community_posts` has exactly one `body` per row and nowhere for a second person to attach a response — this is what keeps "structured hub, not chat room" an enforced property rather than a stated intention that erodes the first time someone asks for a comment thread. **Referrals are never a post type** — a community's referral view is the existing Network Activity feed (§9), filtered to the community's `area_id`/`specialization`/`source_institution_id`/`source_practice_id`, never a fourth `community_post_type`. Routing referrals through `community_posts` would bypass the access-tier gate, consent wording, and shortlist mechanics that exist specifically to protect referral data.

**Response signal — a single Like, same shape as YouTube, deliberately not richer:**

```sql
CREATE TABLE community_post_likes (
  post_id UUID NOT NULL REFERENCES community_posts(id),
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)                            -- toggle: insert on tap, delete on un-tap
);

CREATE TABLE community_post_views (
  post_id UUID NOT NULL REFERENCES community_posts(id),
  user_id UUID NOT NULL REFERENCES users(id),
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)                            -- first view only, same rule as referral_events' referral_viewed
);
```

- **Like count: visible to everyone**, on the post — answers "did this land."
- **View count: visible to the poster only, never public** — same visibility rule already applied to the reciprocity stat and profile views (§10H, §9); a visible low view count is demotivating in exactly the way a public "0 profile views" counter already was.
- **No dislike, no reaction picker, no comment thread.** A dislike button in a 25–30 person professional community where everyone knows everyone is a near-guaranteed source of unnecessary friction; a reaction picker is the specific mechanic that starts sliding this toward the social-media dynamics this feature was built to avoid.

**Institution/certification logos — auto-pull the name, never auto-pull the image.**

```sql
ALTER TABLE master_institutions ADD COLUMN logo_url TEXT;              -- nullable, admin-curated only, never scraped
ALTER TABLE master_courses_certifications ADD COLUMN logo_url TEXT;    -- nullable, same rule, scoped to the certification allow-list
```

Institution and certification *names* already flow through OCR extraction and the existing curation queue (§8B2) — no change there. **Logos are different: a third party's crest or mark is trademarked, and auto-displaying it programmatically risks the same "implies official standing" problem already flagged in §1 for the product name itself, just recurring at the institution level.** Default is a generated placeholder (initials + deterministic colour). A real logo is only ever admin-uploaded, one at a time, after a manual check that identifying the entity by name/logo is acceptable — starting with the short certification allow-list, since the institution list grows too large to do this for comprehensively, and a placeholder is a perfectly fine permanent state for most institutions, not a gap to be filled.

**Why join a community instead of just filtering the directory by college or certification (§9):** a directory filter is stateless and pull-only — nothing persists once the search is closed, and there's nowhere to post anything. A community pushes into the dashboard/weekly digest (§10H) without the person remembering to look, gives members somewhere to actually post (resources, announcements) rather than only being found, and is a standing membership rather than a transient query result — a real, if small, piece of professional identity, as long as it stays strictly on the "belonging" side of the line and never drifts into comparison or rank (§1A).

**Founding-cohort exception — NEW in v18, the one Community that ships at pilot launch, day one, regardless of headcount.** The ≥100 gate exists to prevent *auto-generated* institution/certification/workplace communities from starting embarrassingly empty at low density. A single, founder-created, founder-moderated community for the whole founding cohort has none of that risk — it starts with every pilot member on day one, and it has an accountable owner (the founder) the same way workplace communities do. This isn't new build — §13 already planned to run this manually as a WhatsApp group; this just runs that same group using the platform-curated Community mechanics already specified above (Announcement/Resource posts, Likes, private view counts) instead of WhatsApp itself, which turns it into a direct, live test of §11's WhatsApp-displacement hypothesis rather than something only measurable after Communities properly launches post-pilot.

**Event posts are P0 for the founding-cohort community specifically, not deferred with the rest.** The Event type was already minimal by design — no RSVP, no capacity, no ticketing, a bulletin listing only — so allowing it now costs nothing beyond what's already specified; only the P1 timing changes, not the feature itself. In-person meetups for a 25–30 person founding cohort are a real trust-building lever (referrals go more easily to therapists you've actually met), and the format was already safe enough to ship early. Event posts stay deferred for every other Community type, including the same founding-cohort community's future life post-pilot once it's no longer the one exception.

**Rollout, mapped to the existing density gate (§2):**

| Phase | What ships | Gate |
|---|---|---|
| 0 | **Founding-cohort community** (platform-curated, Announcement/Resource/Event posts, Likes/views) | **None — ships at pilot launch** |
| 1 | Circles, private bookmarking only, no referral targeting | Any time after pilot core is stable — doesn't depend on network size |
| 2 | Communities generally: platform-curated, Network-Activity-feed-filtered view, Likes/views | ≥100 verified active therapists/city |
| 3 | Institution, certification, and workplace auto-generation | Same gate, plus each type's own density sub-threshold above |
| 4 | User-created communities | Same gate, plus the curation-queue moderation model |
| 5 | Circle- and community-targeted referrals; Event posts for non-founding communities | P1/P2 — after the fallback-timing decision (above) is made and Phase 2 proves the format gets used |

Pilot substitute for everything except Phase 0: unchanged from v17, a WhatsApp group for anything not covered by the founding-cohort community.

### F. Recruiting — **schema in v1, surface gated on a two-part trigger** *(refined in §2)*

Reuses existing machinery: **`practice_claims` gates who can post**, the **credentials-verified gate governs who can apply**, stays **free**.

```sql
CREATE TYPE vacancy_status AS ENUM ('draft','pending_review','open','filled','closed','removed');

CREATE TABLE vacancies (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id          UUID NOT NULL REFERENCES practices(id),
  posted_by_user_id    UUID NOT NULL REFERENCES users(id),
  role_needed          TEXT NOT NULL,
  specialization       TEXT,
  area_id              UUID REFERENCES areas(id),
  employment_type      TEXT,
  compensation_text    TEXT,
  description          TEXT NOT NULL,
  status               vacancy_status NOT NULL DEFAULT 'draft',
  reviewed_by_admin_id UUID REFERENCES admin_users(id),
  reviewed_at          TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX vacancies_board ON vacancies (status, area_id, created_at DESC)
  WHERE deleted_at IS NULL AND status = 'open';
```

**Posting requires a `claimed` practice with an approved `practice_claims` row** — enforced in the query.

**No `vacancy_applications`. Listings only.** Therapists contact practices directly using the same reveal-on-tap contact pattern as profiles (§9).

**Why the surface waits — refined trigger in v18.** Not build effort — an adoption dependency chain: practices must exist → owners must claim them → claims must be verified → only then can a vacancy be posted. **At ~100 verified therapists in a city, begin actively soliciting practice claims** — this doesn't happen on its own, something has to kick off the chain. **The vacancy board surface itself ships once ≥5 approved `practice_claims` exist in that city** — headcount alone risks shipping an empty board even with hundreds of therapists signed up, since claims follow owner effort, not therapist growth.

**Every vacancy is admin-reviewed before going live.**

---

### G. Cross-Cutting

```sql
notifications ( id, user_id, type, payload, channel, status, created_at )

admin_users ( id, user_id, created_at )
-- No `role` column here — see §8G5's admin_user_roles junction table.
-- A stale earlier draft of this summary line carried an inline `role`
-- column that predates §8G5's fuller spec (multiple independently
-- assignable/revocable roles per admin); §8G5 is the source of truth.

areas (
  id, name, slug, city,
  parent_area_id,
  level area_level NOT NULL,                 -- 'city'|'zone'|'locality'|'sub_locality'
  is_active BOOLEAN NOT NULL DEFAULT false,
  google_place_id                             -- opportunistic only; never bulk-populated
)
CREATE UNIQUE INDEX areas_unique_slug_in_parent ON areas (parent_area_id, slug);
CREATE INDEX areas_selector ON areas (level, parent_area_id) WHERE is_active;

-- [v19] Materialized ancestry. Two features traverse this tree — referral matching
-- ("area_id matches or falls within their home_visit_areas") and the empty-pool parent-zone
-- fallback (§8D) — both on every referral post. At ~150 curated rows across four levels,
-- maintaining an ancestor array on insert costs nothing and turns both into array containment.
ALTER TABLE areas ADD COLUMN ancestor_ids UUID[] NOT NULL DEFAULT '{}';
CREATE INDEX areas_ancestors ON areas USING gin (ancestor_ids);

audit_logs (
  id,
  actor_user_id,
  actor_type,
  acting_context,
  action,
  target_table, target_id,
  outcome,
  correlation_id,
  before_state, after_state,                  -- PII REDACTED (§5)
  ip_address, created_at
)
-- APPEND-ONLY. Revoke UPDATE and DELETE from the application role at the
-- database level; do not rely on convention.
```

> **Google Places terms prohibit bulk caching of Places data**; `google_place_id` may only be stored when a user actually selects a place through Autocomplete.

---

### G2. Reporting — deferred for the pilot

**Out of scope for the pilot.** A suspected credential or identity issue is raised by direct email to the founder and handled ad hoc. Full design retained in the appendix (§16) for the point where headcount or need makes ad hoc handling unworkable.

**What doesn't disappear:** a genuinely serious matter — credible impersonation, or anything suggesting immediate risk — still gets handled directly, one-off, human. No clinical finding is ever recorded, in any form.

---

### G3. Feedback

```sql
CREATE TYPE feedback_category AS ENUM ('bug','feature_request','verification_issue','content_issue','other');
CREATE TYPE feedback_status   AS ENUM ('new','triaged','planned','shipped','wont_do');

CREATE TABLE feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  category    feedback_category NOT NULL,
  message     TEXT NOT NULL CHECK (char_length(message) BETWEEN 5 AND 4000),
  context     JSONB NOT NULL DEFAULT '{}',
  contact_ok  BOOLEAN NOT NULL DEFAULT false,
  status      feedback_status NOT NULL DEFAULT 'new',
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX feedback_triage ON feedback (status, created_at DESC);
```

- **`verification_issue` routes into the admin queue**, not this backlog.
- No response-time promise anywhere in the UI.
- Rate limit 5/day/user.

---

### G4. Push Notifications

Web push, from day one. Service worker + browser Push API + VAPID keys via `web-push`, against FCM and Apple's push infrastructure.

```sql
CREATE TABLE push_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  endpoint     TEXT NOT NULL,
  p256dh_key   TEXT NOT NULL,
  auth_key     TEXT NOT NULL,
  user_agent   TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX push_sub_unique ON push_subscriptions (user_id, endpoint);
CREATE INDEX push_sub_by_user ON push_subscriptions (user_id, last_seen_at DESC);
```

**Constraints:**
- **iOS Safari requires the PWA be added to the home screen first.**
- **Ask for permission contextually**, immediately after first successful verification.
- **Subscriptions go stale silently** — track `last_seen_at`, fall back to email for stale subscriptions.
- **The admin-phone fallback stays.**

---

### G5. Admin Roles and Grievance Channel

```sql
CREATE TYPE admin_role_type AS ENUM (
  'super_admin', 'verification_admin', 'grievance_officer',
  'support_admin', 'referral_ops_admin', 'technical_admin'
);

CREATE TABLE admin_user_roles (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id        UUID NOT NULL REFERENCES admin_users(id),
  role                 admin_role_type NOT NULL,
  assigned_by_admin_id UUID REFERENCES admin_users(id),
  assigned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at           TIMESTAMPTZ,
  revoked_by_admin_id  UUID REFERENCES admin_users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX admin_user_roles_active_unique
  ON admin_user_roles (admin_user_id, role) WHERE revoked_at IS NULL;
CREATE INDEX admin_user_roles_by_role ON admin_user_roles (role) WHERE revoked_at IS NULL;
```

**Two guards:**
1. **Bootstrap.** Seed migration or CLI command for the first super-admin, documented.
2. **Last-super-admin lockout.** Block any revocation that would leave zero active `super_admin`.

**Auditing.** Every insert/update writes `audit_logs`, no PII.

#### Admin context separation

**One account, two contexts. Not two accounts.**

- **`/app/*` for therapist work, `/admin/*` for admin work.**
- **Re-authentication to enter admin mode**, with a **2-hour idle timeout**.
- **Unmissable visual distinction.**
- **`audit_logs` records the acting context.**
- **Admin reads of patient contact data are audited, not just mutations.**

#### Grievance channel

- **`grievance` is its own `feedback` category** with `acknowledged_at` / `resolved_at` columns.
- **`grievance_channel_published` config flag, default `false`.**
- **Do not publish any grievance address** until §15A clears and a named admin is checking the inbox.

---

### G6. Admin Section — Information Architecture and Monitoring — NEW in v18

**Split the admin surface into two categories, built two different ways — this is the central decision, not a detail.**

| Category | Examples | How it's built |
|---|---|---|
| **Write actions** — anything that changes state | Approve/reject a credential or practice claim, approve a community moderator, assign an admin role, resolve a grievance | **Custom-built under `/admin/*`**, per §8G5's admin context separation, server-side role enforcement, and audit logging. No way around building this properly — these are the actions the whole security model in §8G5 exists to protect. |
| **Read-only monitoring** — everything in §12's ops dashboard list | Signups by locality, verification queue depth, referral funnel, unserved urgent referrals, communities pending curation | **Not custom-built — the conclusion is unchanged, the tool's timing is not.** Every §12 query is already plain SQL. **[v19] For the pilot these run as saved queries against the `analytics` views** (below); Metabase is pointed at those same views once ops load justifies its hosting cost. A custom analytics page for a tool 2–6 admins will ever open is still real engineering time spent reinventing something that exists — the same cost-minimalism logic applied to OCR vendor choice (§8A2) and hosting (§7). |

**Custom admin navigation — write actions only, scoped by `admin_role_type` (§8G5), nobody sees a section they don't hold a role for:**

| Section | Role required | Content |
|---|---|---|
| Verification queue | `verification_admin` | Credentials, Approve / Raise query / Reject (§8A2) |
| Practice claims | `verification_admin` | Same queue mechanism, reused per §8C1 |
| Communities | `verification_admin` or an approved community moderator (§8E3) | Institution/certification curation, pending community posts, moderator applications |
| Referral ops | `referral_ops_admin` | Empty-pool alerts, unserved urgent referrals, 2-reroute escalations (§8D) |
| Grievance | `grievance_officer` | The dedicated queue from §8G5 |
| Feedback | `support_admin` | The `feedback` table, excluding `grievance` (§8G3) |
| Team and roles | `super_admin` only | The panel already specified in §8G5 |
| Analytics | *(link out)* | Not a section — an outbound link to whatever renders the `analytics` views, visible to any admin role, since analytics is read-only and doesn't need the same access scoping as the write-action sections above. **[v19]** Absent during the pilot, when those queries are run saved rather than rendered by a hosted tool |

**[v19] The `analytics` view layer, and why it exists before the tool does.** §8G5 requires that admin reads of patient contact data be audited, not just mutations — but a BI tool connected straight to Postgres bypasses `audit_logs` entirely, and would read every column it can see. So the reporting surface is a schema of read-only views, queried through a third database role (`ahp_analytics`, alongside the migration owner and `ahp_app` from §7) with access to **those views only, never base tables.**

The views exclude, at minimum: `patient_summary`, `location_address`, `urgency_reason`, `public_contact_value`, `legal_name`, `email`, `credentials.ocr_extracted_json`, `registration_number`, `document_url`, `feedback.message`, and `audit_logs.before_state`/`after_state`. Nothing in §12 needs any of them — every metric there is an aggregate, a status, a foreign key, or a timestamp.

Built in Phase 0, before any reporting tool exists. Retrofitting a restricted surface onto a BI tool already pointed at the raw database is the kind of thing that does not get done once the dashboards work.

**What the monitoring surface shows, organized as dashboards rather than a flat list — same metrics as §12, just grouped:**
- **Growth** — signups by locality (the bar chart already specified in §12), D30 return
- **Verification** — queue depth, median turnaround, credentials in `query_raised` and their age
- **Referrals** — posted/accepted/expired funnel, unserved urgent referrals, reroute distribution, poster-reported completion (labelled self-reported)
- **Practices** — open claims, `possible_duplicate_of`/`disputed` flags, progress toward the ≥5-claims recruiting gate (§2)
- **Communities** — institutions/certifications pending curation, posts pending review

**Why this split holds up under the plan's own logic:** the write-action side is exactly what §8G5 already spent real design effort protecting — server-side role checks, audit logging, admin-context re-authentication. None of that logic applies to a chart showing "signups this week." Building both the same way would either over-engineer the charts or, worse, under-protect the queue actions by treating them as equally low-stakes.

---

### H. Retention, Deletion, and Anonymisation Matrix

| Table | On erasure request | Retained (and why) | Retention |
|---|---|---|---|
| `users` | Null `email`, `photo_url`, `bio`, `availability_notes`; replace with `deleted-user-{hash}` | `id` (referential integrity) | Indefinite as tombstone |
| `credentials` | Delete R2 objects; null `registration_number`, `ocr_extracted_json`, `document_url` | `status`, `verified_at` | Documents: 12 months post-verification |
| `therapist_skills` | Null `proof_url`, delete R2 objects | Skill names | — |
| `home_case_referrals` | Null `patient_summary`, `location_address` | `area_id`, `specialization_needed`, timestamps | Contact fields: purge 90 days after `completed`/`expired` |
| `push_subscriptions` | Delete all rows for the user | — | Purge with no successful delivery in 90 days |
| `admin_user_roles` | Not anonymised — no PII | Full history | Indefinite |
| `practice_claims` | Delete R2 documents; null `registration_number`, `query_message` | Status, timestamps, reviewing admin | Documents: purge 12 months post-decision |
| `contact_reveals` | Null `revealed_data`, `ip_address` | `referral_id`, `revealed_to_user_id`, timestamps | Purge revealed_data at 90 days |
| `master_institutions` | No PII — institution names only | Full | Indefinite |
| `referral_interest` | No PII | — | — |
| `reports` *(deferred)* | Null `description`, `evidence_urls`, delete R2 | Category, status, resolution | Evidence: purge 12 months post-resolution |
| `feedback` | Null `message`, `user_id` | Category, status | Purge messages at 24 months |
| `invites` | Null `code` | Counts only | — |
| `audit_logs` | Not anonymised — already redacted at write time | Full log | 24 months |
| `notifications` | Null `payload` | Type, timestamps | Purge payloads at 90 days |

**Two rules that follow:**
1. **Anonymisation must be irreversible.**
2. **Time-based purges run regardless of deletion requests.**

Backups: encrypted, 30-day rotation, documented restore procedure.

---

## 9. Directory & Search

```
/directory                                → all therapists & practices, filterable (incl. languages, institution)
/directory/[role]/[city]/[area]
/directory/[specialization]/[city]
/pt/[therapist-slug]
/clinic/[practice-slug]
```

**Filter taxonomy — refined in v18, modeled against Practo and Psychology Today's "Find a Therapist," the two closest comparables.** Neither Zocdoc's insurance-driven model nor Yelp/Google's ratings-driven one maps to this product — Practo is the right comparable for an Indian healthcare directory's filter *breadth*, but its ratings/satisfaction-score filter is the one thing deliberately not copied, since it violates §1A's no-ranking rule outright. Psychology Today is the model for *how* to present the filters: a small default set, everything else behind progressive disclosure, so a first-time patient visitor isn't handed twenty controls at once.

**Default filters, always visible:**

| Filter | Backing field |
|---|---|
| Role | `role` |
| Locality | curated `areas` (§6) |
| Home visit / clinic visit | `accepts_home_visits` / `accepts_clinic_visits` |
| Specialization | `specialization_type` / `therapist_skills` |

**"More filters," progressive disclosure — everything else:**

| Filter | Backing field | Note |
|---|---|---|
| Language | `languages TEXT[]` | Already existed, already usable |
| Institution | `credentials.institution_id → master_institutions` | New in v18 (§8B2) — searching "Manipal" or "NIMS" matches on the linked credential, not a free-text scan |
| Certification | `course_completions → master_courses_certifications` | Same curation-backed matching as institution |
| Gender | `users.gender` | New field, this round — self-reported, optional, `'prefer_not_to_say'` is a distinct choice from leaving it blank |
| Age groups served | `users.age_groups_served` | New field, this round — pediatric/adult/geriatric, multi-select, self-reported |
| Experience | `years_experience`, bucketed (0–2 / 3–5 / 6–10 / 10+) | Bucketed rather than exact — cheap to build, avoids a filter granular enough to feel like it's ranking |
| Tele-rehab available | `tele_rehab_available` | Field already existed on `users` since v7 but was never wired into any directory filter — this closes that gap, no schema change needed |
| Credentials verified only | `verification_stage = 'credentials_verified'` | **[v19] Defaults OFF, everywhere — corrected.** v18 defaulted it on for the public directory, which hid every `qualification_confirmed` profile from the one audience that tier was invented for (§8A1a exists precisely because most practicing physiotherapists cannot yet reach the top tier), and contradicted §10C's promise that an unverified profile is "live, listed, appears in directory search." The distinction is carried by the ranking below — Credentials Verified above Qualification Confirmed above Unverified — and by the badge on each card, not by hiding people. Any searcher who wants only the top tier turns the filter on. |

**What's deliberately excluded, and why it isn't a pilot-vs-later question:**
- **Ratings, reviews, or a patient satisfaction score** — the one thing Practo leans on hardest, and the one filter permanently off the table under §1A. Not deferred, rejected outright.
- **Consultation fee** — no fee data exists; pricing and patient booking are out of scope entirely (§3, §8D2). A filter needs a field behind it, and this one doesn't have one yet, by design.
- **Insurance** — doesn't map to the Indian market the way it does for Zocdoc's US model; not worth building for any version of this product.

**Filter narrows the result set; it never changes the sort.** Regardless of which filters are applied, the §9 ranking order below is unconditional — no filter, now or later, introduces a "sort by rating" option even as an opt-in.

**Ranking, updated in v18 for the two-tier verification system (§8A1a):**
1. Credentials Verified > Qualification Confirmed > Unverified
2. Availability recency — `available_for_new_patients = true`, ordered by `availability_updated_at` descending
3. Profile completeness score
4. Randomised tiebreaker

### Sharing therapist details — the relay mechanic

**Public profiles: reveal-on-tap, never in page markup.** Rate-limited per IP, every reveal logged. Therapist chooses `contact_preference` at profile setup.

**[v19] Public reveals get their own table.** v18 required every reveal logged but gave it nowhere to go — `contact_reveals` (§8D) is direct-mode only and dormant for the entire pilot, and relay mode explicitly writes no row there. A public-directory reveal is a different event with a different actor (an anonymous visitor), different data, and different retention.

```sql
CREATE TABLE profile_contact_reveals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_user_id UUID NOT NULL REFERENCES users(id),
  ip_hash         TEXT NOT NULL,          -- hashed, not stored raw; drives the per-IP rate limit
  user_agent      TEXT,
  revealed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX profile_contact_reveals_rate ON profile_contact_reveals (ip_hash, revealed_at DESC);
CREATE INDEX profile_contact_reveals_by_profile ON profile_contact_reveals (profile_user_id, revealed_at DESC);
```

Rate limiting runs against this table at pilot volume; **Cloudflare KV stays P1** (§7) and is only introduced if profiling shows an actual need. Purge `ip_hash`/`user_agent` at 90 days, consistent with §8H's treatment of comparable fields.

**Accepted referrals:** poster gets a **"Share [name]'s details"** button that opens a WhatsApp share sheet.

**SEO:** Schema.org `Person` on therapist profiles, `MedicalBusiness` on practice pages. OG images server-generated for every profile and practice page.

### Network Activity feed — NEW in v18

**Purpose:** give every therapist a reason to open the app on a day nothing personal is happening, and make platform momentum visible to a small cohort. See §10H for how this fits the broader engagement approach.

- Shows **every open referral platform-wide**, regardless of whether it matches the viewer.
- Each card shows only **structured fields**: role needed, specialization, urgency, zone/locality, age bracket, time posted. **Never `patient_summary` free text.**
- **No "Express interest" action unless the viewer actually matches** (role + specialization + area + accepting_referrals + verified). Non-matching viewers see a plain, non-interactive card with a subtle "not in your area/specialty" label — not a greyed-out button, which invites rage-taps.
- **Consent scope note:** kept strictly to structured fields for the reason stated in §8D2 — the existing consent checkbox wording covers sharing with "another therapist on this platform for the purpose of arranging a referral," written for the matched-pool audience. Extending it to platform-wide visibility of the free-text summary would be a bigger disclosure than that sentence currently covers; if that's ever wanted, it needs its own consent-wording pass with counsel, not a quiet extension.
- **New-member cards, added in v18 — a direct fix for the feed being genuinely empty at pilot density.** Recent verified signups surface as feed cards alongside referrals (*"Priya Nair just joined — Physiotherapist, Kondapur"*), same visual treatment, no interest/accept action, presence only. No new schema — one more query into the feed's data source, reading off `users.created_at` and `verification_stage`. This means the feed always has *something* even in week one, before a single referral has been posted.

---

## 10. Mobile & Onboarding

Mobile-first for the therapist app. Onboarding is designed to feel rewarding at each step, not merely low-friction.

### 10A. Founding cohort — defined once, reused everywhere

```sql
ALTER TABLE users ADD COLUMN is_founding_member BOOLEAN NOT NULL DEFAULT false;
```

**`is_founding_member = true` for every account created before the §14 go/no-go review.**

### 10B. Onboarding moments

```sql
CREATE TYPE onboarding_moment AS ENUM (
  'profile_preview_shown', 'locality_context_shown',
  'verification_celebration_shown', 'share_card_generated'
);

CREATE TABLE user_onboarding_moments (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID NOT NULL REFERENCES users(id),
  moment   onboarding_moment NOT NULL,
  shown_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX user_onboarding_moments_once
  ON user_onboarding_moments (user_id, moment);
```

### 10C. Onboarding sequence

| Step | Ask | Deliver |
|---|---|---|
| 0 | Nothing | Public profile or directory page |
| 1 | Google one-tap, or 6-digit code (via Supabase Auth, §4) | Signed in |
| 2 | **Name, role, locality. Three fields.** | **A live preview of their public profile.** |
| 2.5 | Nothing | **Locality context** — see §10D |
| 3 | Nothing | Peers in their locality, any open referrals — and now the **Network Activity** feed (§9, §10H) if their own locality is quiet. **[v20] Plus one line setting the gate expectation early (§G6):** *"Browse these now — claiming one needs a credential check (2 minutes, one photo)."* |
| 4 | Credential upload, preceded by the disclosure line in §10E. **[v20] "I'll do this later" is an explicit, first-class option** that sets a reminder rather than dead-ending (§G7) | *"Credentials-checked profiles can claim referrals"* — **[v20] plus an immediate visible state change, not only a promise (§G5)** |
| — | *(async, on approval)* | **Verification celebration + shareable card — §10F.** **[v20] Fires for BOTH tiers** (§G8) |
| 5 | 3 skill chips + photo | Benefit-specific copy per field — §10G |
| 6+ | Courses, practice, home-visit areas, languages, availability, **home-visit toggle + accepting-referrals toggle (NEW, §8A)** | A "strengthen your profile" checklist |

**Fallback for incomplete verification:** the profile is live, listed, labelled *Unverified*, appears in directory search, can browse but not claim referrals.

### 10D. Locality context

**One rule:** real, specific count if ≥1 active therapist or open referral in the locality; **founding-cohort framing** if zero. Never a bare zero. **No precise ordinal, ever, anywhere** — including the dashboard/activity feed added in this revision (§10H); this constraint now explicitly extends to every new engagement surface, not just the original onboarding moment.

### 10E. Credential upload — one honest line before the field

> *Your certificate is reviewed by an AHP Network admin to confirm your registration details. It's stored privately and only admins can see it — never shown on your public profile. We keep it for 12 months after your credentials are checked, then it's deleted.*

**[v20] A clear phone photo of a physical certificate is explicitly acceptable, and the UI says so** (§G7). §8A2 already commits to validating OCR against deliberately poor phone photos before launch — the interface should not imply a scan is required when the pipeline is built to tolerate a photo. Most of this cohort will not have a scanned degree on their phone; implying they need one converts a two-minute task into a "later" that never comes.

### 10E1. The waiting state is a designed surface — [v20], see §G5

**The drop-off risk in verification is the wait, not the ask.** §2 targets <24h internally and publishes "usually within 2 working days," but §8A2's own capacity model (8–12 min/document, 4–6 hrs/week at 30 signups/week) against a solo founder means a busy week stretches that. Someone who uploaded on day one and has heard nothing by day four has already concluded the platform is inactive — and they concluded it while doing exactly what was asked of them.

While a credential sits `pending` or `under_review`:

- **Show a real expected time derived from current queue depth**, not a fixed marketing promise. If the queue is genuinely long, saying so is better than a "2 days" that passes silently.
- **Never a bare "pending" with nothing else on screen.** Pair it with what they can still do right now — complete their profile (§10G), browse the board, see who else is nearby.
- **The queue-depth alert at 15 (§2) is the same signal viewed from the ops side.** When that alert fires, this surface is already telling users the truth; the two must not disagree.

### 10F. Verification celebration, share, and next steps

On approval: a brief in-app celebratory state, with two follow-on actions.

**[v20] This fires for BOTH tiers, with tier-appropriate copy (§G8).** `qualification_confirmed` was invented in §8A1a specifically to *avoid* excluding the majority of practicing physiotherapists during the NCAHP transition. If reaching it produces silence while `credentials_verified` produces a celebration, the tier built to prevent exclusion becomes a way of signalling it. Reaching `qualification_confirmed` is a genuine milestone for someone whose statutory registration is pending nationally rather than personally — the copy should say what they *have* earned (a confirmed qualification, a directory tier, community eligibility) without implying they are most of the way to something else.

**Share — the profile URL, not a standalone image.** Shares `ahpnetwork.in/pt/[slug]?ref=[code]`, unfurling via the same OG image the profile page already generates.

**Founding-cohort framing lives in the profile's permanent OG image**, gated on `is_founding_member`.

**Invite — a second action alongside Share**, reusing the existing invite mechanism.

**This is entirely opt-in and personal.**

### 10G. Completion copy — named and benefit-specific

| Field | Copy | Why this wording, not stronger |
|---|---|---|
| Skills | *"Add 3 skills → show up when someone searches for them"* | True directly — search-match, not ranking |
| Photo | *"Add a photo → your profile looks complete to visitors"* | Trust signal, not ranking |
| Availability toggle | *"Set your availability → move up in local search"* | Accurate per §9's ranking |
| Credentials | *"Upload your certificate → unlock claiming referrals"* | The one hard gate (§8A3) |
| Courses | *"Add your training → richer profile for anyone who visits"* | Deliberately weaker — courses don't move ranking |

### 10H. Dashboard & Engagement — NEW section in v18

**Purpose: give therapists a reason to open the app on days with no personal activity, without violating §1A's no-ranking rule or §9's rejection of gamed engagement signals ("last login" was removed for exactly this reason — rewards presence, not usefulness).**

Everything here reuses data already collected. Nothing here compares one therapist to another.

**1. Network Activity as the dashboard home screen, not a side tab (§9).** On a day a therapist has no open interest and nothing pending, this is what gives them a reason to open the app anyway — the only one of these three ideas that provides value with zero personal activity that day.

**2. Reciprocity, shown as a private, first-person fact — never a score.**
- *"You've helped connect 3 patients this month."*
- *"3 people joined AHP Network through your invite."*

Both numbers already exist (`referral_interest.status = 'accepted'`, `invites.accepted_by_user_id`) — this is a display choice, not new tracking. **The line between this and a rating is real and must be held exactly:** this counts what the therapist actually did, shown only to them, never compared to anyone else, never contributing to ranking or badge state. A rating is someone else's judgment of them, shown publicly. Keep it strictly on the private-fact side of that line.

**3. A weekly digest, push and/or email — "This week in your network."**
New signups nearby, referrals posted and resolved, anything relevant to their specialty/locality. **The one genuinely new build item in this section:** a single scheduled job querying tables that already exist, alongside the cron jobs already planned for nudges and purges (§8A3, §8H). This is the lever that pulls someone back on a week they weren't otherwise opening the app — the other two ideas only work if they're already in the app.

**4. The completion checklist (§10G) stays as-is, surfaced from the dashboard rather than buried in a settings menu.** No changes to its content — it's already engagement-by-honesty done right.

**Explicitly avoided:** streaks, daily-check-in rewards, or any mechanic that reward opening-the-app-for-its-own-sake rather than the app being useful that day. Consistent with §9's existing rejection of "last login" as a signal — engagement that rewards presence over usefulness trains the wrong habit and is a fast way to lose trust in a community this size, where everyone will notice and talk to each other about it.

### Abandonment fixes (mid-tier Android, unstable networks)

1. **No Google Places in the therapist locality selector.**
2. **6-digit code as the default mobile auth path** (§4, now via Supabase Auth).
3. **Client-side compression for credential documents** — with the failure-preserving fallback described in §7.
4. **OCR fully async.**
5. **Chunked forms, save on field blur.**
6. Cache the last-viewed referral board.

---

## 11. Activation Metrics

### The primary pilot question — unchanged in v18

> **"Will therapists create, complete, and trust local profiles?"**

This stays primary because the underlying constraint that produced it hasn't changed: in relay mode, the platform cannot observe whether handover actually occurred (§8D), so referral completion cannot serve as the primary measured criterion regardless of how the question is framed. A differently-worded primary hypothesis doesn't remove that observability gap.

### Secondary track — added in v18: pre-acceptance funnel speed and WhatsApp displacement

What genuinely *is* cleanly measurable, and wasn't tracked before: everything up to acceptance. Added as a named secondary lens, using the `referral_events` additions from §8D:

| Metric | What it tells you |
|---|---|
| Posted → `notification_dispatched` | Whether the notification pipeline itself is fast |
| Posted → `referral_viewed` (first view) | Whether the matched pool is actually paying attention |
| Posted → first `interest_expressed` | The real "beats WhatsApp" number — a WhatsApp group's first response time is the baseline this needs to beat |
| Posted → `shortlisted` → `accepted` | Full pre-handover funnel speed |
| **% of referrals the poster says would otherwise have gone to WhatsApp** *(new, self-reported at posting or shortly after)* | Direct displacement signal — cheap to ask, one optional field |

**Poster-reported post-acceptance completion is tracked as an explicitly-labelled secondary metric**, same as v17: consistent 80%+ suggests relay is sufficient permanently; 40% is the argument for direct mode. **Label it "self-reported" everywhere it is displayed.**

| Metric | Target | Note |
|---|---|---|
| Signup → role + locality set | 85% | Below 70% means step 2 is too heavy |
| Signup → credential uploaded within 7 days | 40–45% | Realistic ceiling for a free directory |
| Credential uploaded → checked | 90% within 48h | Capacity-bound |
| Checked → viewed a referral within 14 days | 60% | If low, the board is empty — supply problem |
| **Referral posted → accepted (shortlist race)** | **50%+ within 72h routine / 8h urgent** | The real health metric |
| Selection → contact acknowledged within 4 working hours | 80% | Tests push + deadline |
| Push permission granted, of verified therapists | 65% | Below 50% means mistimed prompt or iOS friction |
| Push delivered → acknowledged | — (measure, don't target) | Evidence for whether 4h can safely tighten to 2h |
| D30 return | 35% | Above 25% is fine at this stage |
| Median verification turnaround | <18h | Leading indicator for the SLA promise |
| **% of therapists posting/claiming ≥2 referrals in the pilot window** *(new, secondary)* | Track, don't gate | With 25–30 therapists and 60–90 days, this number will be small and noisy either way — useful signal, not a go/no-go threshold |

---

## 12. Weekly Ops Dashboard

- New signups; signup → checked conversion
- **Signups by locality/city, as a simple bar chart** *(NEW in v18)* — one `GROUP BY area_id` (rolled up via `areas.parent_area_id` to zone/city) against `users`, no new schema. **Admin-only** — §10D's rule against public leaderboards or precise counts extends explicitly to this: this view never becomes therapist-facing.
- Verification queue depth and median age of oldest item
- Checked actives per specialty × locality (the density map)
- Referrals posted / selected / expired-unmatched
- Median time-to-acceptance; referrals with `reroute_count ≥ 2`
- **Posted → first view, posted → first interest** *(new, §11)* — the WhatsApp-displacement comparison numbers
- Contact reveals issued vs. completed handovers (the ratio)
- Therapists with ≥2 lapsed acknowledgements in 30 days
- Feedback items by category
- Supply gaps: zone × specialty combinations where `matched_pool_size_at_post = 0`
- Invites sent vs. accepted
- Push delivery rate and count of stale subscriptions
- Admin-role holders who also hold verified therapist profiles
- Open grievance items with acknowledgement and resolution times
- Credentials in `query_raised` and their age
- **Institutions pending curation** *(new, §8B2)* — same pattern as course-taxonomy curation
- Open practice claims; practices flagged `possible_duplicate_of` or `disputed`
- **Claimed practices per city, against the recruiting trigger** *(new, §2)* — tracks progress toward the ≥5-approved-claims gate
- Unserved urgent referrals — zone, specialty, matched-pool size, time open
- Urgent / routine referral ratio, with `urgency_reason` visible
- Poster-reported completion rate — LABEL AS SELF-REPORTED
- Public profile contact reveals
- Vacancies pending review (once the surface ships)
- Reroute count distribution; referrals reaching the 2-reroute admin escalation
- Relay referrals with no poster confirmation after 48h

**[v19] Every metric above runs against the restricted `analytics` views (§8G6), never against base tables, and never as custom application code.** During the pilot these are saved queries; they become Metabase dashboards unchanged once its hosting cost is justified — the SQL does not change, only what renders it. Grouped as Growth, Verification, Referrals, Practices, and Communities rather than one flat list — see §8G6.

**No metric here requires patient or contact data.** If one ever appears to, that is a signal the metric is wrong, not that the views are too narrow.

---

## 13. Scope

### P0 / P1 / P2 build boundary — NEW in v18

Added to give the Claude Code handoff one canonical priority structure, consolidating what v17's changelog left as "still genuinely open" into concrete, resolved decisions.

**P0 — pilot launch, all of it:**

Auth via Supabase Auth (§4) with admin context separation · users with `account_type`, `accepting_referrals`, `gender`, `age_groups_served`, `verification_stage` (two-tier: `qualification_confirmed`/`credentials_verified`, §8A1a), home-visit/clinic-visit toggles wired into matching · `therapist_skills`, `credentials` (with `institution_id`, `council_id`, `credential_type`), `home_visit_areas` · `master_institutions` curation queue · `master_councils`, pilot-seeded with 3 rows (TGPMB, NCAHP, IAP — TGPMB's registration function confirmed locally before seeding), future-state rows curated on demand via the same `pending_review` queue as institutions · auto-sync from approved degree/PG credentials into `course_completions` (§8A1a) · credential upload → OCR → admin queue · admin verification queue with SLA tracking · `admin_user_roles` + Team & Roles panel · custom admin section IA (verification, practice claims, communities, referral ops, grievance, feedback — §8G6), role-scoped per `admin_role_type` · **[v19]** restricted `analytics` views + `ahp_analytics` role for read-only ops monitoring, queried as saved SQL during the pilot; Metabase deferred until its hosting cost is justified (§8G6, §12) · curated Hyderabad `areas` · public directory, search with full filter taxonomy — default filters (role, locality, visit type, specialization) plus progressive-disclosure filters (language, institution, certification, gender, age groups served, bucketed experience, tele-rehab, verified-only) — profile pages, schema.org · therapist/practice referral board — structured `role_needed`/`specialization_needed`, targeted matching filter, shortlist race, urgency levels, relay contact mode only, plain-language display wording · patient-summary UI guardrail (placeholder + warning) · Network Activity feed, including new-member cards for feed density at low pilot volume · **founding-cohort Community, shipped at pilot launch as the one exception to the ≥100 gate (§2, §8E3), including Event posts for this community specifically** · onboarding (live profile preview, locality context, credential-upload disclosure, verification celebration + share card, benefit-specific completion copy) · dashboard engagement (reciprocity stat, weekly digest job) · `user_onboarding_moments`, `is_founding_member` · `referral_events` (incl. `notification_dispatched`, `referral_viewed`) · `auth_identities` · `vacancies` schema (surface deferred, gated per §2) · `contact_reveals` schema (dormant) · `push_subscriptions` and web push · invites, no reward layer (considered and rejected, §8A4) · therapist-created practices with Places dedup, `practice_claims`, affiliation consent · `feedback` incl. `grievance` category · `notifications`, `audit_logs` · data export and deletion requests · retention purge jobs · footer placeholders gated by `grievance_channel_published`, bridged in the interim by the Founding Member Declaration and Interim Data & Privacy Notice (§15A) · **deadline scheduler on a real sub-hourly cadence, idempotent** (resolved, not open — detailed in §8D's timing section) · **directory indexes matching actual query predicates, no N+1 in directory rendering** (resolved as a P0 engineering requirement) · **public pages not gated behind authenticated root-layout state** (resolved as a P0 requirement — public directory ISR must not depend on auth) · **deterministic migration ordering** · **`matched_pool_size_at_post` and `matching_algorithm_version` populated by the frozen v1 filter, not a placeholder** · Cloudflare R2 for all storage, accessed via its S3-compatible API not native bindings (§7) · database connection setup isolated to one file (§7) · **[v19]** Cloudflare Hyperdrive for **all** queries including the referral transactions, which are PL/pgSQL functions invoked as a single statement each and therefore atomic under transaction-mode pooling — the Supavisor session-mode bypass is withdrawn (§7) · **[v19]** `users.role` typed and `users.specializations` populated, as the matching filter's only backing fields (§8A, §8D) · **[v19]** `lapse_offers()` transaction, `idempotency_keys`, `notification_outbox` claim/dedupe columns, `areas.ancestor_ids`, `profile_contact_reveals`, `recompute_verification_stage()` as the single writer of `verification_stage` · **[v19]** two database roles with `audit_logs` writes refused to the app role · **[v19]** one server-side authz module, no RLS · **[v19]** centralised user-facing copy with build-failing no-ranking and footer-gate tests · OpenNext (`@opennextjs/cloudflare`), not `vinext`, as the deployment adapter (§7) · nightly backup + restore test · cost triggers and safety valves configured before launch

**P1 — after core pilot proves value:**

Cloudflare KV persistent caching (only if profiling shows a need) · more sophisticated matching beyond the plain filter (only with real density data) · advanced practice-claim workflows · richer notification centre · improved OCR automation · deeper product analytics · availability enhancements

**P2 — future product:**

Direct/patient-facing referral mode · patient accounts · patient booking ecosystem · recruiting marketplace expansion beyond listings · AHP Professional ID/Passport · advanced practice management · monetisation · multi-city optimisation · AI/ML matching (explicitly not for the pilot, at any point)

### Manual / concierge at pilot

| Feature | Manual version |
|---|---|
| Empty-pool fallback | Alert → you personally call a therapist |
| Institution curation | Admin curates from OCR extraction + submissions, same as course taxonomy |
| Supply-gap view | Weekly SQL query |
| Circles & Communities (§8E2, §8E3) | WhatsApp group for the founding cohort |
| CE hours | Spreadsheet |
| Practice claim review | Reuses the credential queue and its Approve / Raise query / Reject actions |

### Deferred to v1.5

**Direct contact mode** — fully specified in §8D, dormant. · **Recruiting surface** — schema ships in v1; board ships per the two-part trigger in §2. · **Credential-fraud reporting** — full design in the appendix. · **Circles** — fully specified in §8E2, P1. · **Communities** — fully specified in §8E3, gated at ≥100 verified active therapists per city (§2), phased per §8E3's rollout table.

**Patient-originated referrals in full** · blog · CE/CPD hour tracking · reciprocity as anything beyond a private first-person stat · profile analytics/`profile_stats` (beyond the reciprocity stat above — see §3's future paid tier) · peer recommendations

### Deferred to v2

Professional ID / Passport · WhatsApp OTP and notifications · masked/proxy calling · patient ratings and reviews · multi-city · rewards/badges · profile insights, digital verified-profile card, patient direct appointment booking (future paid tier) · practice storefront page and local demand insights (separate practice-side monetization track) · profession expansion — Prosthetists & Orthotists, then Dietitians/Nutritionists · sponsored content / equipment vendors / course providers

### Removed

`practice_style` · `notification_preferences` JSONB · `blog_post_reports` (merged into `reports`) · the ₹99 price display · all pre-seeded profile functionality · **custom magic-link auth implementation** (replaced by Supabase Auth) · **`referral_reason` structured field** (considered, dropped — absorbed into optional `additional_context`) · **S3, CloudFront, Vercel Analytics from the launch architecture**

*Note: `profile_stats` and `bookmarks` were previously listed here in error — both are deferred, not removed. `profile_stats` is tracked under §3's future "Profile insights" tier; `bookmarks` is now fully specified as Circles (§8E2).*

---

## 14. Go / No-Go for Broader Launch

Do **not** enable public patient referrals, locality-level matching, or a second city until **all** of the following hold for **two consecutive weeks**:

- ≥60% of referrals selected within 72h
- ≥40 credentials-verified, active therapists (logged in within 30 days)
- <10% of referrals expiring unmatched
- Median verification turnaround <18h with queue depth <15
- Completed-handover ratio >0.6
- Contact acknowledgement within 4 working hours on ≥80% of selections
- Push permission granted by ≥65% of verified therapists
- **Zero unresolved trust incidents** (impersonation, contact misuse, contested affiliation)

*Communities and Recruiting have their own, separate density gates (§2) — they are not tied to this table. Circles has no density gate at all (§8E2).*

---

## 15. Legal and Regulatory Review Checklist

DPDP obligations attach to processing personal data, not to revenue — they apply from the first signup, regardless of pricing. **These are open items; this document does not resolve them.**

### 15A. Before pilot launch — cannot wait

1. **Privacy policy and terms of service.**
2. **DPDP consent artefacts and grievance-officer appointment.** `patient_consent_recorded_at` records attestation, not adequacy of wording — put the exact wording to counsel now. **Also confirm the Network Activity feed's structured-fields-only scope (§9, §8D2) sits within the same consent wording**, since it's a new surface added in this revision.
3. **§1A "Credentials Verified" disclaimer wording**, plus a standard independent-contractor/marketplace clause in the ToS.

**Interim bridge, until the above is complete — NEW in v18.** A Founding Member Declaration and Interim Data & Privacy Notice exist as separate documents, written in plain founder-voice language, explicitly labeled as non-legal, temporary, and pre-registration. These are not a substitute for items 1–3 above — they exist specifically because TheraNet Technologies is not yet a registered entity and formal counsel engagement is intentionally sequenced to follow signal from the pilot, per the founder's own stated approach. Both documents should still get at least a basic sanity check given the health/patient-data angle, even though full counsel engagement is deliberately deferred. Replace both in full once items 1–3 land — do not let the interim versions persist past the pilot.

### 15B. Before monetization, recruiting, ads, courses, or events — genuinely defers

4. Intermediary status and IT Rules due-diligence obligations, given the reporting feature.
5. Defamation posture on credential-fraud reporting.
6. Retention basis for credential documents following a deletion request.
7. **Patient-originated referrals in full.**
8. Payment/subscription terms, refund policy, GST registration.
9. Advertising and sponsored-content rules; course/event provider agreements.
10. Recruiting/job-posting compliance — before the vacancy board surface ships.
11. Trademark clearance search before filing.
12. Google Places terms compliance on `google_place_id` storage.
13. Licence terms of the All India Pincode Directory for commercial use, if multi-city expansion uses it.
14. **Practice listing exposure** — publishing an unclaimed business's name and address, added by a third party.

### Recommended engagement now

A single bounded engagement covering 15A items 1–3: privacy policy, terms of service, and a DPDP readiness note. Prepare a one-page internal data-processing register beforehand.

---

## 16. Appendix — Deferred Schemas

### Reporting (§8G2) — retained design, not built in the pilot

```sql
CREATE TYPE report_target_type AS ENUM ('user','practice','credential');
CREATE TYPE report_category AS ENUM (
  'credential_fraud','impersonation','profile_inaccuracy','spam_or_solicitation','other'
);
CREATE TYPE report_status AS ENUM (
  'received','triaging','awaiting_reporter_info','substantiated',
  'unsubstantiated','referred_out','duplicate','abusive_report'
);
CREATE TYPE report_action AS ENUM (
  'none','badge_revoked','account_suspended','content_removed','referred_out','reporter_warned'
);

CREATE TABLE reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id UUID NOT NULL REFERENCES users(id),
  target_type      report_target_type NOT NULL,
  target_id        UUID NOT NULL,
  target_user_id   UUID REFERENCES users(id),
  category         report_category NOT NULL,
  description      TEXT NOT NULL CHECK (char_length(description) BETWEEN 30 AND 4000),
  evidence_urls    TEXT[] DEFAULT '{}',
  status           report_status NOT NULL DEFAULT 'received',
  severity         SMALLINT NOT NULL DEFAULT 2 CHECK (severity BETWEEN 1 AND 3),
  assigned_admin_id    UUID REFERENCES admin_users(id),
  resolution_action    report_action,
  resolution_notes     TEXT,
  resolved_by_admin_id UUID REFERENCES admin_users(id),
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  CONSTRAINT resolved_fields_together CHECK (
    status IN ('received','triaging','awaiting_reporter_info')
    OR (resolved_at IS NOT NULL AND resolved_by_admin_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX reports_one_open_per_reporter_target
  ON reports (reporter_user_id, target_type, target_id)
  WHERE status IN ('received','triaging','awaiting_reporter_info') AND deleted_at IS NULL;
CREATE INDEX reports_queue     ON reports (status, severity DESC, created_at) WHERE deleted_at IS NULL;
CREATE INDEX reports_by_target ON reports (target_user_id, created_at DESC)  WHERE deleted_at IS NULL;
```

Anti-abuse rules to reapply on build: max 2 open reports per reporter; no automated action at any volume; report count never feeds ranking or badge state; reporter must be credentials-checked; reciprocal-report and cluster detection route to human review; accused is never told who reported; a substantiated finding revokes the badge with no public reason stated.

`blog_posts`, `vacancy_applications` retained for v1.5/v2 reference, not built in the pilot, moderation and permission models to be specified at build time. **Circles and Communities are no longer a stub design** — both are fully specified in §8E2/§8E3, including schema, moderation, posting rules, and rollout phasing; only the build itself is deferred, per the gates in §2.
