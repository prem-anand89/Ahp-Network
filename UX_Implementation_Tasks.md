# UX Implementation Tasks — Gemini plan, reconciled with Step 7

This file started as Gemini's proposed UX plan (`.gemini/antigravity/brain/4d88fce6…/implementation_plan.md`), copied in with every item unchecked. An audit against `main` (2026-09-26) found roughly a third already built in Round 2/3, a few items superseded by later decisions, and several conflicting with CLAUDE.md's non-negotiables. Step 7 (see `partitioned-snacking-panda.md`) built the remaining valid items. This file now reflects the real state — check it before treating anything below as still open.

- [x] **Phase 1: Database & Verification Schema Updates**
  - [ ] ~~`recompute_verification_stage` DB fix (registration alone grants `credentials_verified`)~~ — **Rejected.** The two-part rule (degree AND registration) is a deliberate Round 2 decision (`copy.ts` records it). Registration alone already reaches `qualification_confirmed`, which can accept referrals since Round 3 decision 1 — nobody is blocked.
  - [x] ~~`0025_seed_hyderabad_full.sql`~~ — **Superseded** by the national India Post registry (Round 3 step A, `scripts/load-india-post-areas.ts`).
  - [x] `curation_status` column on `areas` — done (`drizzle/0049`, `519eee5`).

- [x] **Phase 2: Admin Dashboard & Global Nav**
  - [x] "Review Areas" queue — done, `/admin/curation/areas`.
  - [x] Top nav = Home | Referrals | Directory | Communities | Practices — done, Step 7A. Circles moved to the account menu.
  - [x] lucide-react icons in top nav — done, Step 7A.

- [x] **Phase 3: Onboarding & Verification UI**
  - [x] "Your specialties" (up to 3) + "Accepting new patients" toggle on Step 2 — done, Step 7B. (Renamed from "Top specialties" — that phrase trips the §1A no-ranking-language scanner.)
  - [x] "Suggested Connections" Step 2.5 — done, Step 7B. Up to 3 same-city verified therapists (random draw, never sorted by any count) + 1 community.
  - [x] "Upload a credential & verify" as the primary Step 3 CTA, "Skip to dashboard" as a subtle link — done, Step 7B.
  - [x] Credential upload redesign — done, Step 7C: two visual cards (Council Registration / Academic Degree) replace the dropdown; Fast Track banner already existed; front/back multi-file upload added (`credentials.document_back_url`, `drizzle/0057` — scoped to exactly one second file, not an arbitrary-N document table, so retention.ts/erasure.ts's existing single-row purge logic covers it without a rewrite).

- [x] **Phase 4: Dashboard & Profile Overhaul**
  - [x] Dashboard 2-column grid — done, Step 7A (`md:grid-cols-3`, sidebar: profile snapshot, checklist, push opt-in, city progress, reciprocity).
  - [x] Redundant dashboard button row (Founding cohort / Referral board / Circles / Communities) — removed, Step 7A. All four are reachable from AppNav or the account menu now.
  - [x] Circles moved to the account/profile menu — done, Step 7A.
  - [x] "Refer Patient" as the public profile's primary CTA, "Add to Circle" downgraded — done, Step 7D (`AddToCircleButton` gained a `variant` prop; the profile passes `"ghost"`).
  - [x] 15-member Circle cap — done, Step 7D (`CIRCLE_MEMBER_CAP` in `circles.ts`, enforced server-side; tested).
  - [x] Avatar piles, "+ Create Circle" sheet with embedded directory search — done, Step 7D.

- [x] **Phase 5: Referral Board & Targeting**
  - [x] Board tabs (Matched to me / My posts / Explore network) — done, Step 7E. Explore reuses `getNetworkActivityFeed`, not a new query. Tab lives in `?tab=`, not client state.
  - [x] `expand_to_network` switch under First Look — done, Step 7E. Default on; the server still forces it off in a locked city regardless of what the switch sends.
  - [ ] ~~Simultaneous circle + community targeting~~ — **Deferred, not Step 7.** Needs the `first_look_single_target` CHECK and the notify-set logic changed — referral-engine work, not polish.
  - [x] Unified First Look targeting (one target: circle, community, or therapist) — already done, Round 2 (`6a41e51`).
  - [ ] ~~+12h/+24h Extend Time~~ — **Superseded.** Round 2 chose +1h urgent / +6 waking hours routine instead; unchanged.
  - [x] Dynamic 2h/12h offer expiry, overnight pause — already done, Round 2.

- [x] **Phase 6: Case Brief Refinements**
  - [x] "All-Clear" toggle + quick-insert precaution tags — done, Step 7F.
  - [x] "Primary goal / expected outcome" field — done, Step 7F (new JSONB key, no migration needed).
  - [x] Contact window split into method + time — done, Step 7F. Composed into the existing single `preferredContactWindow` column at submit ("Method · time"), so no migration and no reader changes.
  - [ ] ~~1,000-character limit~~ — **Rejected, stays at 300.** Longer free text raises the patient-detail risk §8D2's guardrail exists for.

- [x] **Phase 7: Directory & Communities**
  - [x] Dynamic omni-search — done, Step 7G. `q` param, debounced `useTransition`, matches name/role/certification. Sort order is unaffected (§1A — no relevance ranking shown).
  - [x] ~~Horizontal quick filters~~ — **Superseded** by the filter sheet (`405b980`) and Round 3 step F's city/locality rework inside it.
  - [x] "Connect" removed from directory cards — already true (never existed on `ProfileCard`).
  - [x] "Pledge to Unlock" for communities — already done, Round 2 step 6 (`076ad36`).

- [x] **Phase 8: Practices**
  - [x] Practices in main nav — done, Step 7A (folded into the same change as 7A's nav rework).
  - [x] 2-way consent for practice employees — already done, Round 2 step 3 (`bbf011f`).
  - [x] "Invite to Practice" only in practice management — already true.
  - [x] "Are you the owner/manager?" + optional website/phone on the create form — done, Step 7H.
  - [ ] Practice opening hours, a practice-level "accepting patients" badge — **deferred**, §13's "practice storefront" (v2).

- [~] **Phase 9: Administrative & Security Polish** — split by risk, per founder decision.
  - [x] SLA age colour-coding on curation queues — done, Step 7I (areas/institutions/councils; never on credential review, which stays one-at-a-time).
  - [x] Bulk approve/reject on curation queues — done, Step 7I. Same three queues, never credentials.
  - [ ] Vacation mode / auto-decline, granular per-event notification matrix, "Recent login activity," admin impersonation — **deferred to a separate admin/security round.** Impersonation especially needs its own security review before it's built.

- [ ] **Phase 10: Networking, Gamification & Scheduling (Growth Features)** — **deferred, all of it.** Reasons, so this isn't reopened by accident:
  - [ ] Weekly availability template / "Request to Book" slot selection — conflicts with §1 (Thera.Net Clinic owns clinical/booking workflow) and §13 (patient booking is P2/v2).
  - [ ] "Who viewed your profile" — §13 defers profile analytics to v1.5/v2; a view counter is "demotivating in exactly the way a public '0 profile views' counter already was" (plan, line ~1674).
  - [ ] Peer endorsements — conflicts with §1A ("not a recommendation") and §13 (peer recommendations deferred to v1.5). `peer_notes` (Phase 5) is the §1A-safe replacement already shipped.
  - [ ] Profile completeness progress bar — conflicts with §1A ("no ranking, score, star, or rating language, anywhere, ever"); `profile-completeness.ts` itself already says the score is never shown as a number/percentage/bar.
  - [ ] Native feature-request board with upvoting — vote counts are the kind of count §1A's wording forbids showing; the least clear-cut of the five, but not built without a founder decision to reopen the rule.
  - [ ] "Clinical Question" community post type — no explicit rule conflict, but near the EMR boundary (§1) and a patient-information risk similar to `patient_summary`'s guardrail (§8D2). Open for a founder decision later, not built by default.
  - [ ] Circle custom icons/colour tags — cosmetic, skipped for scope, not a rule conflict.
