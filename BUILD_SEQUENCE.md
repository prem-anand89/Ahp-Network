# AHP Network — Build Sequence

Orders the P0 list from plan §13 into phases by actual dependency, not by feature importance. Each phase names the plan sections to read before starting. Work through phases in order — later phases assume earlier ones exist (e.g., the referral board assumes `users`, `areas`, and `practices` are already built and migrated).

Each phase is scoped to be roughly one to a few focused Claude Code sessions, not a single sitting. Don't try to collapse phases to move faster — the dependency ordering is the point.

---

## Before Phase 0 — accounts, keys, and two real-world facts to confirm

None of this is code. Phase 0 assumes all of it already exists — gathering it mid-session is the kind of interruption that breaks a build session's flow for no good reason.

**Accounts and API keys to have ready:**
- Supabase project (Postgres + Auth)
- Cloudflare account: Pages/Workers enabled, an R2 bucket created (or ready to create in Phase 0)
- Google Cloud project with **Cloud Vision API** and **Places API** enabled, plus OAuth 2.0 credentials for Google sign-in
- Sentry project (free tier)
- A place to generate and store VAPID keys for web push (needed by Phase 7, not Phase 0, but worth having the Google Cloud project ready early since Vision/Places/OAuth all live on it)

**Two real-world facts, not build tasks, that block specific later phases if left unconfirmed:**
- **TGPMB's actual registration function** — confirm it covers post-qualification professional registration for practicing physiotherapists, not just paramedical course admissions, before it's seeded into `master_councils` in Phase 2 (plan §8A1a).
- **The two interim legal documents** (`FOUNDING_MEMBER_DECLARATION.md`, `INTERIM_PRIVACY_NOTICE.md`) still have `[founder's email/phone]` and `[date]` placeholders — fill these in before the founding cohort actually sees them, not before Phase 0. Doesn't block any build phase, only blocks onboarding real people.

---

## Phase 0 — Scaffolding

**No plan section — pure setup.**

- Next.js repo, `@opennextjs/cloudflare` adapter wired and deploying an empty page to Cloudflare Pages — **OpenNext, not Cloudflare's newer `vinext`.** This was checked against current state and decided deliberately (`CLAUDE.md`'s hosting section) — don't substitute `vinext` on the assumption it's now the default, without that decision being revisited fresh.
- Supabase project provisioned, Drizzle configured against it, `drizzle-kit migrate` confirmed working (not `push`)
- Cloudflare R2 buckets created (credential documents — private; profile photos — public via CDN)
- **R2 client setup uses R2's S3-compatible API from the first line of code, not Cloudflare's native binding API.** This is a `CLAUDE.md` non-negotiable, not optional — it's the single decision that determines how expensive a future hosting move away from Workers would be, and it costs nothing extra to do correctly now.
- **Database connection setup goes in one isolated file (`db.ts` or equivalent), nowhere else in the codebase.** Most queries connect via Hyperdrive. **The shortlist and accept transactions specifically (Phase 6) connect directly to Supabase's Supavisor pooler in session mode instead — this is a committed decision, not exploratory** (plan §7, `CLAUDE.md`'s hosting section). Both connection paths should still live in this one file.
- CI: lint, typecheck, test, on every PR
- Staging environment
- **Verify session-mode Postgres pooling before anything else** — this blocks Phase 6 entirely if not confirmed now (`CLAUDE.md` non-negotiables, plan §8D/§7)

---

## Phase 1 — Identity core

**Read: §4 (Auth), §8A (Verified Profiles through `auth_identities`), §8G5 (Admin Roles)**

- `users` table with `account_type`, `gender`, `age_groups_served`, `accepting_referrals`, `accepts_home_visits`/`accepts_clinic_visits`, `legal_name`/`display_name` split
- Supabase Auth wired: Google OAuth + email OTP, 6-digit-code-first on mobile user-agents
- `auth_identities` populated from Supabase Auth's identity records
- Sensitive-identity-change protocol: 15-minute re-auth requirement, dual-channel notify, 48-hour referral/contact-disclosure hold, `audit_logs` write
- `admin_users`, `admin_role_type` enum, `admin_user_roles`, bootstrap path for the first `super_admin`, last-super-admin-lockout guard
- `audit_logs` table, append-only enforced at the database role level (revoke `UPDATE`/`DELETE`)
- Admin context separation: `/app/*` vs `/admin/*`, re-auth to enter admin mode, 2-hour idle timeout, visual distinction

**Done when:** a therapist can sign up via both auth methods, an admin can be bootstrapped, and admin-mode entry requires re-authentication with the correct timeout.

---

## Phase 2 — Locations and taxonomy

**Read: §6 (Location Handling), §8B (Course Taxonomy), §8B2 (Institutions), §8A1a (Councils — the `master_councils` table specifically, even though full verification wiring happens in Phase 3)**

- `areas` table, curated Hyderabad set (~100–150 rows, 6–8 parent zones), `area_level` enum, selector UI (grouped tappable chips, zero network calls)
- `master_courses_certifications` + `course_completions`, 4-tier classification, `curation_status` application logic
- `master_institutions` + fuzzy-match scaffolding (`pg_trgm`), `credentials.institution_id` FK — note this table is populated in Phase 3 once OCR extraction exists, but the schema and curation queue UI can be built now
- `master_councils` — **hand-seed exactly 3 rows: TGPMB, NCAHP, IAP.** Confirm TGPMB's actual professional-registration function (not just paramedical course admissions) before seeding it — this is a real-world fact to verify, not something to infer from documentation. Do not build any auto-population logic for this table; it only ever grows via the same `pending_review` admin curation queue as institutions, on demand, when a therapist from outside Telangana actually signs up.
- Certification allow-list for auto-generated communities (Phase 9) — just the curated list of internationally-recognised certifications, no community logic yet

**Done when:** areas selector works end-to-end in a form, course/institution/council curation queues all exist and an admin can approve/reject a pending entry manually inserted for testing in each.

---

## Phase 3 — Credentials and two-tier verification

**Read: §8A (Credentials, Access Tiers), §8A1a (Two-tier verification — read this closely, it's the most consequential trust decision in the whole build), §8A2 (Verification Pipeline), §5 (encryption envelope, for anything touching credential document storage)**

- `credentials` table with `credential_type` enum (`degree`/`postgraduate_degree`/`council_registration`), `council_id` FK, `credential_status` enum, query-raised flow (Approve / Raise query / Reject)
- Signed R2 upload flow, file-type whitelist, magic-byte validation, 5MB cap for credential documents (no client-side compression on these — see plan §7)
- Google Cloud Vision integration, async OCR, `ocr_extracted_json`
- Confidence scoring (name similarity, registration-number format — read per-council from `master_councils.registration_number_pattern`, expiry sanity) — **feeds queue priority only, never writes `credentials.status` or `users.verification_stage`**
- Institution fuzzy-match wired to real OCR output now (Phase 2 built the scaffolding)
- Admin verification queue UI, SLA tracking, queue-depth alert at 15
- **`users.verification_stage` gating logic, exactly as specified in §8A1a's table** — `qualification_confirmed` off any approved `degree`/`postgraduate_degree` credential; `credentials_verified` additionally requires an approved `council_registration` credential linked to a `master_councils` row where `council_type = 'statutory_registration'` specifically. **Write the test asserting an IAP-linked (`professional_association`) registration alone never advances to `credentials_verified`** — this is the one rule in this phase most likely to get quietly violated by a well-intentioned shortcut later.
- Access tiers enforced per the three-row table in §8A3: `patient_summary` and referral-claim actions gated on `verification_stage = 'credentials_verified'` specifically, not `qualification_confirmed`
- Auto-sync: an approved `degree`/`postgraduate_degree` credential creates a matching Tier 1 `course_completions` row (§8A1a) — one-way sync, `credentials` stays the source of truth for gating, `course_completions` for display

**Done when:** a real document upload flows through OCR, produces a scored, prioritized admin queue item, and an admin approval correctly advances `verification_stage` through both tiers and unlocks the right thing at each — with zero path that sets `verification_stage` without a human action, and the IAP-exclusion test passing.

---

## Phase 4 — Practices

**Read: §8C (Practices), §8C1 (Claims), §8C2 (Affiliations), §8C4 (Staff onboarding)**

- `practices` table, Google Places dedup (`google_place_id` uniqueness) + secondary normalized-name/address dedup path
- Therapist-created, owner-claimed flow; unclaimed display rules (no badge, `noindex`, explicit unclaimed label)
- `practice_claims`, reusing the Phase 3 verification queue mechanism (same Approve/Raise query/Reject actions)
- Contested-claim handling (two open claims on one practice → `disputed`, frozen, escalated)
- `practice_users` affiliations, the two consent models (self-asserted vs. practice-asserted)

**Done when:** a therapist can create a practice, a different user can claim it with a document, a second contested claim on the same practice correctly freezes the record instead of erroring out.

---

## Phase 5 — Directory and search

**Read: §9 (Directory & Search) — this is the fullest single section to implement in one phase, read it completely before starting**

- Public routes: `/directory`, `/directory/[role]/[city]/[area]`, `/pt/[slug]`, `/clinic/[slug]`
- Full filter taxonomy: 4 default filters (role, locality, visit type, specialization), 8 progressive-disclosure filters (language, institution, certification, gender, age groups served, bucketed experience, tele-rehab, verified-only)
- Ranking logic exactly as specified — Verified > Unverified, availability recency, completeness, random tiebreak — **no sort-by-rating option, ever, regardless of which filters are active**
- Reveal-on-tap contact, rate-limited per IP, every reveal logged
- schema.org markup (`Person`, `MedicalBusiness`), OG image generation

**Done when:** every filter in the taxonomy table returns a correctly narrowed result set without changing sort order, and a profile's contact value never appears in page markup before the reveal action.

---

## Phase 6 — Referral board core

**Read: §8D (Referral Board) in full, §8D2 (Patient Consent) — the most implementation-sensitive phase in the whole build, budget real review time here**

- `home_case_referrals`, `referral_interest`, structured `role_needed`/`specialization_needed` dropdowns, `additional_context`, `home_visit_required`
- Targeted matching filter (role + specialization + area + `accepting_referrals` + visit-type match) — plain SQL filter, not a scoring engine
- Consent checkbox, `patient_consent_recorded_at` NOT NULL gate, `patient_summary` placeholder + inline warning
- **Shortlist transaction and accept transaction, implemented exactly as written in §8D, including row locking, rowcount assertions, and rollback conditions — connect via the direct Supabase Supavisor session-mode connection for these two transactions specifically, not the Hyperdrive connection used everywhere else in the app.** This is the committed mitigation for Hyperdrive's transaction-mode-only limitation (plan §7, `CLAUDE.md`'s hosting section) — don't route these through Hyperdrive on the assumption a single wrapped `db.transaction()` call is fine; the mitigation exists specifically so this question doesn't need re-litigating mid-build.
- **Fail-closed on the Supavisor connection itself.** If it fails — network blip, pool saturation, timeout — the endpoint returns a "please try again" error. It never silently falls back to Hyperdrive. Write this as an explicit error path, not an afterthought; a silent fallback here reintroduces the exact risk the whole mitigation exists to remove.
- `notification_outbox`, transactional writes from both transactions above, separate worker for actual sends
- Deadline scheduler on a real sub-hourly cadence (cron-based polling, not daily)
- Display-wording layer, kept separate from the internal state enum
- Empty matched-pool fallback (parent-zone expansion), urgency-scaled timing table
- `referral_events`, including `notification_dispatched` and `referral_viewed`
- **Verify signup, referral post, shortlist, and accept all behave correctly under `wrangler dev`, not just `next dev`, before marking this phase complete.** `next dev` runs on Node.js locally; production runs on Workers' V8 isolates — genuinely different runtimes. This is not optional polish, it's how a phase actually gets marked done.

**Done when:** two distinct kinds of concurrency tests both pass under real concurrent load — conflating them tests neither properly:

**Race-correctness tests** (the shortlist is capped at 2 candidates, so this is inherently a 2-way race, not an arbitrary large number):
1. No referral ever holds more than 2 `shortlisted` interests.
2. No referral is ever `accepted` by more than one therapist.
3. Every `accepted` referral's shortlisted sibling, if one existed, is always `not_selected`, never dangling.

**Connection-pool load test** (a separate concern — does the Supavisor session-mode pool itself hold up under aggregate concurrency, not just whether one race resolves correctly):
4. Fire concurrent transactions (order of dozens) across many *different* referrals simultaneously. Verify no connection-pool exhaustion, no cross-transaction lock bleed, no dropped or hung connections.

---

## Phase 6.5 — Warm-standby Railway deploy (one session, do not skip)

**No plan section — a discipline check, not a feature.**

Once Phase 6 is genuinely stable — not before, since this is the point the referral engine and the Supavisor-bypass logic actually exist, and that's the piece most likely to ever need migrating — spend one session deploying the same codebase to Railway, standard Node.js hosting.

- **Do not keep it running.** This isn't a second production environment; tear it down after confirming it works.
- **Document the exact steps taken**, so this isn't re-derived from scratch under pressure if the ripcord (§7's named triggers) is ever actually pulled.
- **This is the same discipline the plan already requires for backups**: "test a restore before launch... an untested backup isn't one." An untested contingency plan isn't a real contingency plan either — this session exists to find out now, calmly, whether the two portability rules (§7 — R2's S3-compatible API, the isolated connection file) actually hold up in practice, rather than discovering a gap only when there's real urgency to migrate.

**Done when:** the app deploys and runs correctly on Railway with no code changes beyond environment configuration and the one database-connection-file swap. If it doesn't, that's a real finding — fix the portability gap now, while there's no pressure, not later.

---

## Phase 7 — Push notifications

**Read: §8G4**

- `push_subscriptions`, VAPID keys, service worker
- Contextual permission prompt (post-first-verification, not on page load)
- `notification_outbox` worker now actually sends via push where a live subscription exists, falls back to email
- Stale-subscription handling (`last_seen_at` tracking)

**Done when:** a shortlist notification from Phase 6 actually reaches a device via push, and a stale subscription correctly falls back to email without erroring.

---

## Phase 8 — Onboarding and engagement

**Read: §10 in full**

- Onboarding sequence (§10C), live profile preview at step 2, locality context (§10D)
- Credential upload disclosure line (§10E)
- Verification celebration + share card, reusing the Phase 5 OG image generation (§10F)
- Invite mechanism (`invites` table, §8A4), WhatsApp deep link primary, **no reward layer — this was considered and rejected outright, not a missing feature to add later**
- `is_founding_member`, `user_onboarding_moments`
- Completion checklist copy (§10G) — use the exact wording table, don't paraphrase
- Dashboard/engagement (§10H): Network Activity feed as the home screen, including **new-member cards** (recent verified signups shown alongside referrals, no interest/accept action — this is what keeps the feed non-empty in week one before any referral's been posted), reciprocity stat (private, first-person, never comparative), weekly digest cron job
- **Founding-cohort Community — pulled forward from Phase 9, build here, not there.** This is P0, not P1: it ships at pilot launch as the sole exception to Communities' ≥100-therapist gate (§2, §8E3). Only the narrow slice needed: `communities` (one row, `origin = 'platform_curated'`), `community_posts` (announcement/resource/**event** — event is allowed for this community specifically, still bulletin-only, no RSVP/capacity, ever), `community_post_likes`, `community_post_views`. **Do not build institution/certification/workplace auto-generation, `community_moderators`, or Circles here** — that's the rest of Phase 9, genuinely P1, and stays there.

**Done when:** a new signup sees the live preview before any further data entry, a verified therapist sees the celebration screen with working share/invite actions on approval, the Network Activity feed shows new-member cards even with zero referrals posted, and the founder can post an Announcement/Resource/Event to the founding-cohort community that every pilot member can see and Like.

---

## Phase 9 — Circles and full Communities (P1 — everything except the founding-cohort community already built in Phase 8)

**Read: §8E2 (Circles), §8E3 (Communities) — read the four community origin types carefully, each has genuinely different membership and moderation rules**

- `circles`, `circle_members` — build this first, it's simple and has no dependencies beyond `users`. Lives in Profile/settings, not a shared tab with Communities (§8E2's navigation-placement note)
- `community_members`, the `practice_community_members` view (workplace communities derive membership live, never store it)
- Weekly auto-generation job: institution/certification (density-gated, ≥5), workplace (claimed practice + ≥2 affiliations) — all gated behind the ≥100-therapist threshold from §2, on top of each type's own sub-threshold
- `community_moderators` — self-nomination + admin approval, scoped narrowly, outside `admin_role_type`
- `pending_review` gate for posts in unowned (institution/certification) community types — the founding-cohort community from Phase 8 doesn't need this, it's owned (founder-moderated)
- Institution/certification logo handling — placeholder default, admin-upload only, never scraped

**Done when:** all three auto-generation sources correctly gate on both the ≥100 macro-gate and their own density sub-thresholds, an institution/certification community post from a non-moderator correctly enters `pending_review`, and a workplace community's membership correctly changes when an affiliation's `ended_at` is set — with no separate row to update.

---

## Phase 10 — Admin section and Metabase

**Read: §8G6 in full**

- Custom `/admin/*` write-action screens, role-scoped exactly per the table in §8G6: verification queue, practice claims, communities curation, referral ops, grievance, feedback, team & roles
- Metabase deployed (self-hosted, docker-compose is fine), connected directly to the Supabase Postgres instance
- Every §12 metric wired into a Metabase dashboard, grouped as Growth / Verification / Referrals / Practices / Communities — **do not build any of this as custom application code**

**Done when:** every write action in the admin nav correctly enforces its required role server-side (test by attempting each action with an unauthorized role and confirming denial), and the Metabase dashboards are live against real (or seeded test) data.

---

## Phase 11 — Recruiting, feedback, retention

**Read: §8F (Recruiting), §8G2 (Reporting — appendix schema, do not build the UI), §8G3 (Feedback), §8H (Retention matrix)**

- `vacancies` schema only — **no board surface, no application flow.** This ships dormant, gated per §2's two-part trigger, and that gate is a manual ops decision, not something to build a feature flag for yet
- `feedback` table including the `grievance` category, `grievance_channel_published` flag defaulting `false`
- Retention/purge cron jobs per the exact table-by-table matrix in §8H — this is not one blanket rule, check every row
- Data export (background job, 24-hour presigned link) and deletion request flow (admin task, not an instant button)

**Done when:** the retention purge jobs correctly anonymise each table per its specific rule in §8H, and a data export request produces a real bundle via a working presigned-link email flow.

---

## Phase 12 — Pre-launch hardening

**No new features — verification and gating only.**

- Re-verify session-mode pooling in the actual staging/production environment, not just locally
- **Hard gate, not a checklist item: the referral board does not go live to real users until both the race-correctness tests and the connection-pool load test from Phase 6 pass against staging under real concurrent load.** If either fails here, halt launch — do not proceed on the assumption it'll be fixed post-launch. This is the single trigger that overrides every other launch consideration (plan §7).
- Nightly `pg_dump` to R2 via GitHub Actions, 30-day rotation; **run a full restore test before this phase is considered done**
- Cost-trigger alerts configured and confirmed firing correctly at their thresholds (Supabase storage, R2, Google Places spend, OCR volume, **Hyperdrive daily query count approaching 100,000, Supavisor pool utilization sustained above ~70%**)
- Footer legal links confirmed still unpopulated (§15A gate) — this should be true right up until counsel delivers, don't accidentally ship placeholder links
- Full walkthrough of the P0 list in plan §13 against what's actually built — treat any gap found here as blocking, not a fast-follow

**Done when:** this phase is the actual go/no-go gate for opening real signups, separate from §14's later go/no-go for broader launch.
