# AHP Network — Build Sequence

**Amended after the v19 architecture review** — Phase 0.5 is new, and Phases 0, 1, 2, 3, 5, 6, 6.5 and 12 carry corrections. Read `ARCHITECTURE_REVIEW.md` before starting any phase: §E records five decisions now resolved (UI stack, the encryption call site, Metabase hosting, the verified-only filter default, clinic referrals in scope), kept with their reasoning — treat them as made. §F holds the two real-world facts still genuinely open.

**Further amended after the v20 product review** (taken after Phases 0, 0.5 and 1 shipped, before committing to the rest of the build): `ARCHITECTURE_REVIEW.md` **§G** records ten decisions across the three areas the pilot lives or dies on — the referral engine's comprehensibility (G1–G4, Phase 6), credential-verification drop-off (G5–G8, Phase 3), and visual craft (G9–G10, Phases 5 and 6). All three areas were found fundamentally sound; §G is about the places a well-designed system would still have produced a bad *felt* experience. Each is surfaced inline at the phase that consumes it below.

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
- **Database connection setup goes in one isolated file (`db.ts` or equivalent), nowhere else in the codebase.** **[v19] Every query connects via Hyperdrive, the referral transactions included** — they are single-statement PL/pgSQL calls and therefore atomic under transaction-mode pooling, so the v18 Supavisor session-mode second path is withdrawn (plan §7, `CLAUDE.md`'s hosting section). One connection path, one file.
- CI: lint, typecheck, test, on every PR
- Staging environment

**Added by the v19 review — all of these are cheap now and expensive to retrofit:**

- **Two database roles.** Migrations run as the owner; the app connects as a restricted `ahp_app` with `UPDATE`/`DELETE` revoked on `audit_logs`. **Append-only is not real until the app role is a different role from the one that granted it** — Supabase hands you an owner-level connection string by default, and Drizzle will happily use it. Verified by a test asserting an `UPDATE` on `audit_logs` as `ahp_app` is refused (plan §7, §8G).
- **`(public)` as a route group, `app` as a real `/app/*` URL segment, with genuinely separate layouts**, established before any page exists. These are two different Next.js mechanisms, not interchangeable: `(public)` is a pure grouping folder with no URL impact, kept that way so the SEO-driven directory stays at the root (`/`); `app` must be a real path segment (not parenthesized) because §8G5 requires actual `/app/*` vs `/admin/*` URL separation for therapist vs admin work, not just an internal organizational grouping. One `cookies()` or `headers()` call in a shared root layout still opts the whole tree into dynamic rendering and silently kills static generation for the public directory — nothing errors, it just stops being static. Add a CI assertion on build output that directory routes are static/ISR (plan §7, §8G5, §13's P0 requirement).
- **Migration conventions fixed now.** Drizzle-generated migrations for tables; hand-written SQL migrations, tracked in the same journal, for extensions (`pg_trgm`), the PL/pgSQL referral functions, views, and role grants/revocations. Deterministic ordering is a P0 requirement and this is where it gets established.
- **Test stack fixed now.** Vitest. **Everything touching the database runs against a real Postgres** — a Supabase branch or a local container, never mocks. The invariants under test in Phase 6 are database behaviour; a mock cannot fail the way the database can.
- **[E1] Tailwind + shadcn/ui initialised, and the token layer built before any screen.** Copy-in components, no runtime dependency. The token layer carries one constraint from the review: the three verification badges must be distinguishable by **shape and icon and text, never colour alone** — an accessibility requirement and a §1A trust requirement at once. Record it with the tokens, not in a component comment.
- **[E3] A third database role and the `analytics` view layer**, alongside the two roles above. `ahp_analytics` reads a schema of read-only views and **nothing else — never base tables**. The views exclude `patient_summary`, `location_address`, `urgency_reason`, `public_contact_value`, `legal_name`, `email`, `credentials.ocr_extracted_json`, `registration_number`, `document_url`, `feedback.message`, and `audit_logs.before_state`/`after_state`. Nothing in §12 needs any of them. Built now because retrofitting a restricted surface onto a BI tool already pointed at the raw database does not happen once the dashboards work — and because a tool wired straight to Postgres bypasses the `audit_logs` requirement in §8G5.
- **`db.ts` as the single connection file — one path, Hyperdrive.** The v18 session-mode/Supavisor second path is withdrawn (plan §7, v19).

**~~Verify session-mode Postgres pooling before anything else~~ — withdrawn in v19.** It was required because the referral transactions were multi-statement and client-held. As single-statement PL/pgSQL calls they are atomic under transaction-mode pooling, so the pooling mode no longer gates Phase 6. What replaces it as the thing to prove is Phase 0.5 below — and that proves it by running the race, not by checking a setting.

---

## Phase 0.5 — Referral engine spike (NEW in v19 — one session, do not skip)

**No plan section — this is a go/no-go on the hosting bet, taken before five phases are built on top of it.**

The referral board is the product's reason to exist and by far its riskiest mechanic, and in the original sequence nothing about it is proven until Phase 6. The hosting decision, the transaction design, and the concurrency invariants all sit unvalidated behind five phases of other work. This spike moves the moment of truth to the front, while changing course is still cheap.

**Throwaway branch. Two minimal tables (`home_case_referrals`, `referral_interest` — only the columns the transactions touch), the three PL/pgSQL functions from plan §8D, deployed to a real Worker, against real Supabase, over Hyperdrive.** Not `next dev`, not local Postgres. Then prove six things:

1. **Race-correctness** — concurrent accepts on the *same* referral: exactly one wins, the sibling resolves to `not_selected`, zero dangling rows, zero duplicates.
2. **Connection-pool load** — dozens of concurrent transactions across *many different* referrals: no pool exhaustion, no cross-transaction lock bleed, no hung or dropped connections.
3. **Lapse-vs-accept race** — `lapse_offers()` and `accept_referral()` firing on one referral simultaneously. A genuinely different race from (1), and one v18 never specified a transaction for at all.
4. **Google Cloud Vision from a deployed Worker** — REST endpoint, service-account JWT signed via WebCrypto. **The official Node SDK will not run on Workers** (gRPC + application-default credentials), and finding that out in Phase 3 is finding it out too late.
5. **VAPID signing on Workers** — same class of problem, surfaces in Phase 7 otherwise.
6. **`wrangler dev` parity** on all of the above.

**What each outcome means, decided now rather than in the moment:**
- **1–3 fail and can't be resolved within Workers' constraints** → plan §7's first fallback trigger has fired. Reassess hosting *now*, with one throwaway branch to discard rather than five phases to port.
- **4 or 5 fail** → run that one job in a Supabase Edge Function. This is a job-placement fix, not a hosting move — do not escalate it to one.

**Done when:** all six pass from a deployed Worker, and the results are written down. Then **delete the spike.** Its tables are throwaway; its invariant tests are not — they move into the real suite at Phase 6, which is where they become the launch gate.

---

## Phase 1 — Identity core

**Read: §4 (Auth), §8A (Verified Profiles through `auth_identities`), §8G5 (Admin Roles)**

- `users` table with `account_type`, `gender`, `age_groups_served`, `accepting_referrals`, `accepts_home_visits`/`accepts_clinic_visits`, `legal_name`/`display_name` split
- **[v19] `users.role` typed as `role_needed_type`, and `users.specializations specialization_type[]`** — the matching filter's only backing fields. v18 matched specialization against "their skills/expertise" with no queryable column behind it, which made Phase 6's central query unwritable. Add both now, while the table is empty (plan §8A)
- **[v19] Supabase Auth → `users` sync:** `users.id` equals `auth.users.id`; the row is created by a **server action on first sign-in, not a database trigger** — it has to set `account_type` and `is_founding_member`, and a server action is testable. Same action upserts `auth_identities` (plan §4, §8A)
- **[v19] The authz module** — one server-side `can(user, action, resource)` that every route handler and server action funnels through. Every §8A3 access tier is application code, since the app connects as a privileged role over Hyperdrive and RLS is deliberately not used. Build it before there is anything to gate, or the checks end up scattered
- **[v19] The three verification badges as one locked component module**, with the verbatim §1A tooltip copy inside it and tap-accessible (not hover-only) tooltips. Six surfaces will consume this. Build it before any of them exist
- **[E2] The §5 encryption envelope, with `users.public_contact_value` as its one call site.** The pilot's only encrypted field — relay collects no patient phone and `contact_reveals` is dormant, so this is the one column meeting §5's own criterion. Key lives in Cloudflare Workers Secrets (§5, resolved in v19). Protects against database compromise, not disclosure; the value is revealed on tap by design
- **[v19] `copy.ts`** — all user-facing copy plus `CONSENT_TEXT_VERSION`, so a counsel review is a single file diff. Plus the two build-failing tests: the no-ranking copy scan, and the footer-legal gate asserting those `href`s stay empty
- **[v19] The chunked form primitive** — save-on-blur, cancellable/resumable upload, the compression-failure fallback from §7. Used by onboarding, credential upload, practice creation, and referral posting; built once here rather than three slightly different times
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
- **[v19] `areas.ancestor_ids UUID[]`**, maintained on insert — matching and the empty-pool parent-zone fallback both traverse this tree on every referral post; array containment replaces recursive traversal at zero cost on a 150-row curated table (plan §8G)
- **[v19] The area selector is a shared component**, owned by this phase. It is consumed by home-visit areas, referral posting (Phase 6), and directory filters (Phase 5) — build it once, here
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
- **[v19] `recompute_verification_stage(user_id)` is the only thing that writes `users.verification_stage`** — called from the admin approve/reject action and the credential-expiry job, and nowhere else. This is what makes the "only a human admin action advances verification" rule enforceable, and it closes v18's gap where an expired credential left the stage untouched. The IAP-exclusion test below is written against the function, not its callers. Add the nightly drift-reconciliation query
- **[v19] Google Cloud Vision via the Phase 0.5-proven path** (REST + WebCrypto-signed JWT, or a Supabase Edge Function if the spike showed that was needed) — not the Node SDK, which will not run on Workers
- **[v19] `therapist_skills.verification_status` is frozen at `'unverified'`** — no queue, no admin action, no surface. A third verification vocabulary is exactly the badge confusion §1A exists to prevent
- **[v19] Review-screen quality is an ops-load lever, not polish.** §8A2 budgets 10–15 hrs/week of admin work onto a solo founder who is also the developer; the pre-filled review screen is the single thing that turns 12 minutes per document into 8, across the highest-volume recurring task
- **`users.verification_stage` gating logic, exactly as specified in §8A1a's table** — `qualification_confirmed` off any approved `degree`/`postgraduate_degree` credential; `credentials_verified` additionally requires an approved `council_registration` credential linked to a `master_councils` row where `council_type = 'statutory_registration'` specifically. **Write the test asserting an IAP-linked (`professional_association`) registration alone never advances to `credentials_verified`** — this is the one rule in this phase most likely to get quietly violated by a well-intentioned shortcut later.
- Access tiers enforced per the three-row table in §8A3: `patient_summary` and referral-claim actions gated on `verification_stage = 'credentials_verified'` specifically, not `qualification_confirmed`
- Auto-sync: an approved `degree`/`postgraduate_degree` credential creates a matching Tier 1 `course_completions` row (§8A1a) — one-way sync, `credentials` stays the source of truth for gating, `course_completions` for display
- **[G5] The pending/under-review state is a designed surface, not a spinner** (plan §10E1). Real expected time derived from *current queue depth*, never a fixed "2 days" that can pass silently; never a bare "pending" with nothing else on screen — pair it with the completion checklist and the board. **The drop-off risk in this whole phase is the wait, not the ask**: someone who uploaded on day one and hears nothing by day four concludes the platform is dead, having done exactly what was asked
- **[G7] "I'll do this later" is a first-class option that sets a reminder**, not a dead end — and the UI states plainly that a clear phone photo of a physical certificate is fine. §8A2 already commits to validating OCR against deliberately poor phone photos; the interface must not imply a scan is required when the pipeline tolerates a photo. Most of this cohort will not have a scanned degree on their phone mid-shift
- **[G8] The §10F celebration fires for BOTH tiers**, with tier-appropriate copy. `qualification_confirmed` exists to avoid excluding most practicing physiotherapists during the NCAHP transition — if reaching it produces silence while `credentials_verified` produces a celebration, the tier built to prevent exclusion becomes a way of signalling it

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

- **[G9] FIRST, before any directory screen: one bounded visual-identity pass.** Phase 0 produced shadcn defaults on a neutral palette — clean and professional, but not distinctive, and nothing in the phases ahead would produce anything more on its own. Scope is deliberately bounded and is **not** a mockup pass (the flows are already specified, and the badge module and form primitive are already code): **one real accent colour** beyond shadcn neutral, **a type scale**, and deliberate design of the **profile card** and **referral card** as the two hero surfaces. Those two are the product's face — §10F literally shares the profile as its OG image. Do this before the directory is built, not after, or Phase 5 gets retrofitted. Every token still obeys the E1 constraint already recorded in `globals.css`: the three verification badges differ by shape **and** icon **and** text, never colour alone
- Public routes: `/directory`, `/directory/[role]/[city]/[area]`, `/pt/[slug]`, `/clinic/[slug]`
- Full filter taxonomy: 4 default filters (role, locality, visit type, specialization), 8 progressive-disclosure filters (language, institution, certification, gender, age groups served, bucketed experience, tele-rehab, verified-only)
- Ranking logic exactly as specified — Verified > Unverified, availability recency, completeness, random tiebreak — **no sort-by-rating option, ever, regardless of which filters are active**
- Reveal-on-tap contact, rate-limited per IP, every reveal logged — **[v19] into `profile_contact_reveals`**, a new table. The dormant `contact_reveals` is direct-mode only and relay writes no row there, so v18's logging requirement had nowhere to go (plan §9)
- **[E4] The verified-only filter defaults OFF.** Decided — v18 defaulted it on, which hid every `qualification_confirmed` profile from the public directory, the audience §8A1a invented that tier for, and contradicted §10C's promise that an unverified profile is listed and searchable. The ranking already orders Credentials Verified above Qualification Confirmed above Unverified; the distinction is carried by that ordering and by the badge on each card, not by hiding people
- **[E2] Decrypt-on-reveal** for `public_contact_value`, alongside `profile_contact_reveals` above
- schema.org markup (`Person`, `MedicalBusiness`), OG image generation

**Done when:** every filter in the taxonomy table returns a correctly narrowed result set without changing sort order, and a profile's contact value never appears in page markup before the reveal action.

---

## Phase 6 — Referral board core

**Read: §8D (Referral Board) in full, §8D2 (Patient Consent) — the most implementation-sensitive phase in the whole build, budget real review time here**

- `home_case_referrals`, `referral_interest`, structured `role_needed`/`specialization_needed` dropdowns, `additional_context`, `home_visit_required`
- Targeted matching filter (role + specialization + area + `accepting_referrals` + visit-type match) — plain SQL filter, not a scoring engine
- Consent checkbox, `patient_consent_recorded_at` NOT NULL gate, `patient_summary` placeholder + inline warning
- **[v19] The three transactions — `shortlist_referral()`, `accept_referral()`, `lapse_offers()` — wired up from the functions already proven in Phase 0.5**, not written cold here. Each is a PL/pgSQL function invoked as a single `SELECT fn(...)` statement over Hyperdrive; each takes the referral row lock as its serialization point and carries the rowcount assertions, rollback conditions, `referral_events` write, and outbox write from §8D inside one atomic unit. **Never re-implement any of them as client-side statements or a wrapped `db.transaction()`** — that is the thing that would make transaction-mode pooling unsafe, and it is precisely what this form removes. The v18 Supavisor bypass and its fail-closed connection path are withdrawn (plan §7, v19)
- **[v19] `lapse_offers()` is a real transaction, not a prose rule.** v18 described `missed` in prose with nothing writing it, while the sub-hourly scheduler and a live accept can fire on the same referral in the same second. No-op if the referral is no longer `shortlisted`; leave the referral `shortlisted` if a sibling offer is still live
- **[E5] Both visit types ship, and `home_visit_required` has no default.** `NOT NULL`, no `DEFAULT false` — v18's default meant a referral posted without touching the field was a clinic referral, in a product whose premise is home-based care. The posting form makes it a required, un-preselected choice, same discipline as the consent checkbox: it decides who gets notified, so a pre-filled answer is not an answer
- **[v19] `idempotency_keys` table, checked *inside* `accept_referral()`** — a key checked in front of the transaction is not a guard against the race it exists to prevent
- **[v19] `expiry_stage` and `shortlist_closes_at` defined** — both were declared and never defined in v18
- **[v19] `displayFor(state, viewerRole)` as a pure function** with a snapshot test per row of §8D's display table — the separation §8D requires between wording and the internal enum survives only if it has a home
- **[G1] At most two timers are ever user-visible.** All seven deadline types in §8D's timing table stay as scheduler behaviour; the *surface* is what's constrained. The receiving therapist gets exactly one live countdown (the offer window — the only clock gating an action they must take); the poster gets a plain-language state line and **never a countdown**; zone-expansion, admin-alert, auto-close and shortlist-window timers fire as **admin tasks**, not user notifications. Poster-facing nudges cap at one per referral per 24 hours regardless of how many internal timers fire. A poster nudged by three clocks in 48 hours experiences this as nagging — and at 25–30 users a human following up is warmer and cheaper than a notification ladder
- **[G2] `missed` is no longer a permanent bar, and `declined` is a new status.** A `missed` interest MAY re-express on a repost — the old rule punished exactly the behaviour this product is built around (hands on a patient for two hours, cannot answer a two-hour window). Separately, **"Can't take this one" is an explicit tap** resolving to `declined`, so `missed` means only "window closed unanswered." Add `'declined'` to `referral_interest`'s `CHECK` list (TEXT + CHECK, so it migrates inside a transaction). Schema-compatible with no index change: `referral_one_active_interest_per_therapist` covers only `('pending','shortlisted','accepted')`
- **[G3] The losing message does emotional work:** *"[Name] accepted this one first — you were one of 2 chosen out of N interested."* Both numbers already exist. Bare "went to someone else" reads as losing a buzzer race; being shortlisted is a compliment from a peer, and this cohort meets in person
- **[G4] The shortlist screen states the rules before the tap** — up to 2, first to accept wins, and the choice is held 30 min (urgent) / 1 hour (routine). A one-way action with a cooling-off period must not be discovered by taking it
- **[G10] Decide the referral card's visual hierarchy explicitly before building it.** It must carry specialty, locality, urgency, age bracket, visit type, time posted, state wording and an action, on a mid-tier Android at 360px — this is exactly where "simple" is won or lost. Urgency and specialty primary; locality and visit type secondary; everything else tertiary or behind a tap
- `notification_outbox`, transactional writes from all three transactions above, separate worker for actual sends — **[v19] with `next_attempt_at`, `locked_at`, `dedupe_key`, `FOR UPDATE SKIP LOCKED` claiming, and exponential backoff.** v18's table had `attempt_count` and nothing that read it; any overlapping cron run produced duplicate sends, which a 25–30 person cohort notices immediately
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

**Connection-pool load test** (a separate concern — does **[v19] Hyperdrive's pool** hold up under aggregate concurrency, not just whether one race resolves correctly):
4. Fire concurrent transactions (order of dozens) across many *different* referrals simultaneously. Verify no connection-pool exhaustion, no cross-transaction lock bleed, no dropped or hung connections.

**[v19] Lapse-vs-accept race** (a third distinct concern — v18 specified no transaction for this at all):
5. `lapse_offers()` and `accept_referral()` fired simultaneously on one referral never both succeed, and never leave an accepted referral with a `missed` winner.
6. A repeated accept carrying the same idempotency key produces one accept and one stored response, not two attempts.

---

## Phase 6.5 — Warm-standby Railway deploy (one session, do not skip)

**No plan section — a discipline check, not a feature.**

Once Phase 6 is genuinely stable — not before, since this is the point the referral engine actually exists, and that's the piece most likely to ever need migrating — spend one session deploying the same codebase to Railway, standard Node.js hosting.

- **Do not keep it running.** This isn't a second production environment; tear it down after confirming it works.
- **Document the exact steps taken**, so this isn't re-derived from scratch under pressure if the ripcord (§7's named triggers) is ever actually pulled.
- **This is the same discipline the plan already requires for backups**: "test a restore before launch... an untested backup isn't one." An untested contingency plan isn't a real contingency plan either — this session exists to find out now, calmly, whether the two portability rules (§7 — R2's S3-compatible API, the isolated connection file) actually hold up in practice, rather than discovering a gap only when there's real urgency to migrate.

**[v19] This gets cheaper, and the discipline is unchanged.** With one connection path instead of two, and the referral logic living in the database where it travels with a `pg_dump`, the portability surface is smaller than v18 assumed. That is a reason to expect the test to pass, not a reason to skip it.

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

## Phase 10 — Admin section (and Metabase, if justified)

**Read: §8G6 in full**

- Custom `/admin/*` write-action screens, role-scoped exactly per the table in §8G6: verification queue, practice claims, communities curation, referral ops, grievance, feedback, team & roles
- **[E3] Metabase, if and when its hosting cost is justified — pointed at the `analytics` views built in Phase 0, never at base tables.** This phase is much smaller than v18 assumed: the views, the restricted role, and the SQL already exist, so this is deployment and dashboard assembly. During the pilot the same queries run saved against the same views, so nothing is thrown away either way
- Every §12 metric grouped as Growth / Verification / Referrals / Practices / Communities — **do not build any of this as custom application code**

**Done when:** every write action in the admin nav correctly enforces its required role server-side (test by attempting each action with an unauthorized role and confirming denial), and every §12 metric returns correct numbers against the `analytics` views — whether rendered by Metabase or run as saved SQL. **[E3]** The views, not the tool, are what this phase depends on.

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

- **[v19] Re-verify that no referral state transition has been re-implemented as client-side statements** — grep for `db.transaction(` around the referral paths and confirm all three transitions are still single `SELECT fn(...)` calls. This replaces v18's "re-verify session-mode pooling" check, which the function form made irrelevant; the failure condition is now a code shape, not an infrastructure setting
- **Hard gate, not a checklist item: the referral board does not go live to real users until the race-correctness tests, the connection-pool load test, and [v19] the lapse-vs-accept and idempotency tests from Phase 6 all pass against staging under real concurrent load.** If either fails here, halt launch — do not proceed on the assumption it'll be fixed post-launch. This is the single trigger that overrides every other launch consideration (plan §7).
- Nightly `pg_dump` to R2 via GitHub Actions, 30-day rotation; **run a full restore test before this phase is considered done**
- Cost-trigger alerts configured and confirmed firing correctly at their thresholds (Supabase storage, R2, Google Places spend, OCR volume, **Hyperdrive daily query count approaching 100,000, [v19] Supabase connection utilization sustained above ~70%**)
- Footer legal links confirmed still unpopulated (§15A gate) — this should be true right up until counsel delivers, don't accidentally ship placeholder links
- Full walkthrough of the P0 list in plan §13 against what's actually built — treat any gap found here as blocking, not a fast-follow

**Done when:** this phase is the actual go/no-go gate for opening real signups, separate from §14's later go/no-go for broader launch.
