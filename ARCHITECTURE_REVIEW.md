# AHP Network — Architecture Review

**Reviewed:** `ahp-network-plan-v19.md` (reviewed at v18), `BUILD_SEQUENCE.md`, `CLAUDE.md`, at the point where the repository contained documents only and no code.

**Purpose of this document.** A spec this detailed gets implemented literally. This review is the record of everywhere the literal reading is wrong, unbuildable, or silently self-contradictory — found by reading the plan the way an implementer would, not the way an author does. Findings are corrected in the plan itself (v19) and in `BUILD_SEQUENCE.md`; this file is the durable record of *what* was found and *why* each fix was chosen, so the reasoning survives the way every other decision in this plan does.

**What this review did not do.** It did not redesign anything. The plan is unusually strong for a pre-code spec — decisions carry their reasoning, rejected alternatives are recorded with why, and the privacy and trust rules are genuinely well-reasoned. Section D below states plainly what should not be touched.

**How to use it.** Sections A and B are a checklist Phase 0 works through. **Section E is a record of five decisions, all now resolved**, kept with their reasoning so they are not reopened by accident; treat them as made. Section F holds the two things still genuinely open, neither of which is a build task.

---

## A. Blockers — the plan cannot be built as literally written

### A1. The matching filter has no backing field on the therapist side

§8D Step 1 matches `specialization_needed` (a `specialization_type` enum on the referral) against "their skills/expertise." But `users` has no specialization column. `therapist_skills.skill_name` is free text, and `course_completions` is explicitly a display taxonomy. There is no queryable field on the therapist side to match against — so the pilot's single most important query cannot be written.

This is the most consequential finding in the review. Everything the product exists to do runs through this filter.

**Fix.** Add to `users`:

```sql
ALTER TABLE users
  ADD COLUMN specializations specialization_type[] NOT NULL DEFAULT '{}';
CREATE INDEX users_specializations ON users USING gin (specializations);
```

Mirrors the `age_groups_served` pattern already established in §8A — same shape, same no-gating treatment, same "empty array just means you don't surface under that filter." Matching becomes `r.specialization_needed = ANY(u.specializations)`. `therapist_skills` is unaffected and stays the display/chip surface.

### A2. `users.role` is used by matching and the directory but is never typed

§8D defines `role_needed_type`; §8A lists a bare `role` with no type. The matching filter's first clause ("`role_needed` matches their `role`") therefore has no defined comparison.

**Fix.** `users.role role_needed_type NOT NULL`. Matching becomes a plain equality. The enum already exists and already covers exactly the three pilot professions.

### A3. The shortlist transaction never sets the referral to `shortlisted`, so accept can never succeed

§8D's shortlist SQL ends with:

```sql
INSERT INTO home_case_referrals ... SET offer_expires_at = ...;
```

That statement is malformed — an `INSERT` carrying a `SET` clause — and, more importantly, it never writes `status`. The accept transaction immediately below it opens by rejecting anything whose status "is not still `shortlisted`." Implemented verbatim, every accept in the system rolls back.

**Fix.** The statement is an `UPDATE` on the existing row:

```sql
UPDATE home_case_referrals
   SET status = 'shortlisted', offer_expires_at = $3, updated_at = now()
 WHERE id = $1;
```

### A4. The offer-lapse transaction is never specified, and it races the accept

`referral_interest.status = 'missed'` is described in prose (§8D, "On a missed offer") but no transaction anywhere writes it. Meanwhile the deadline scheduler runs on a sub-hourly cadence and a therapist can accept at any moment — so the lapse job and an accept can fire against the same referral in the same second.

This is the third concurrency-sensitive transaction in the referral engine, and it is given none of the rigor the other two receive.

**Fix.** Specify it with the same discipline as the other two, as `lapse_offers(referral_id)`: take the same referral row lock, no-op if `status <> 'shortlisted'` (the accept already won), and write `missed` only to interests still in `shortlisted`. Add lapse-vs-accept to the invariant test suite — it is a distinct race from accept-vs-accept.

### A5. The accept endpoint requires an idempotency key with nowhere to store it

Named as a non-negotiable in both `CLAUDE.md` and §8D, specifically to survive a double-tap on a flaky mobile connection. No table, no column, no mechanism exists for it anywhere in the schema.

**Fix.**

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

The check happens *inside* the accept function, so the guard sits in the same atomic unit as the thing it guards. A key checked outside the transaction is not a guard against the race it exists to prevent.

### A6. `notification_outbox` has no worker-claim mechanism

The outbox pattern is correct and one of the plan's better decisions. The table implementing it is missing everything that makes the pattern safe: no `next_attempt_at`, no lock or claim column, no dedupe key, no backoff policy. `attempt_count` exists but nothing reads or acts on it.

With a sub-hourly cron, any overlapping run or retry produces duplicate sends — to a 25–30 person cohort where a double push notification is immediately noticed.

**Fix.**

```sql
ALTER TABLE notification_outbox
  ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN locked_at       TIMESTAMPTZ,
  ADD COLUMN dedupe_key      TEXT;
CREATE UNIQUE INDEX notification_outbox_dedupe
  ON notification_outbox (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notification_outbox_claimable
  ON notification_outbox (next_attempt_at) WHERE status = 'pending';
```

The worker claims with `FOR UPDATE SKIP LOCKED`. Failures set `next_attempt_at` on an exponential backoff rather than retrying every tick.

### A7. Two columns are declared and never defined

- **`home_case_referrals.expiry_stage`** appears in the schema and is defined nowhere in the document — no type, no values, no rule that writes it.
- **`shortlist_closes_at`** exists as a column, but no row in §8D's timing table gives it a value or a rule. Every other deadline column on that table has one.

**Fix.** Define both or drop both. Recommended: `expiry_stage` as `TEXT + CHECK` (per the plan's own convention for status fields expected to grow) mirroring the reroute/escalation ladder already described in prose; `shortlist_closes_at` gets an explicit row in the timing table alongside `offer_expires_at`.

---

## B. Architecture — decisions the plan currently leaves to be made by accident

### B1. Google Cloud Vision will not run on Workers via its Node SDK

The official client uses gRPC and application-default credentials, neither of which works in a V8 isolate. Several plausible `web-push` paths have the same problem.

This is precisely the "Node.js compatibility gap blocking a genuinely necessary package" that §7 names as a hosting-fallback trigger — but under the current sequence it is discovered at Phase 3 and Phase 7, after the whole platform is committed.

**Fix.** Phase 0.5 proves both from a *deployed* Worker: the Vision REST endpoint authenticated with a service-account JWT signed via WebCrypto, and VAPID signing for web push. If either fails, the fix is to run that one job in a Supabase Edge Function — which keeps the hosting decision intact rather than triggering a move.

### B2. Public-page ISR vs. auth is an architectural rule, not a Phase 5 task

§13's P0 list already says public pages must not be gated behind authenticated root-layout state. But the failure mode is subtle: on OpenNext, a single `cookies()` or `headers()` call in a shared root layout opts the entire route tree into dynamic rendering, silently killing static generation for the SEO-driven public directory. Nothing errors. It just stops being static.

**Fix.** Route groups `(public)` and `(app)` with genuinely separate layouts, established in Phase 0 before any page exists — plus a CI assertion against the build output that directory routes are static or ISR. Retrofitting this after Phase 5 means re-architecting the layout tree.

### B3. `audit_logs` append-only needs two database roles, and nothing sets them up

`CLAUDE.md` correctly insists the append-only guarantee be enforced at the database level rather than by convention. But revoking `UPDATE`/`DELETE` only works if migrations run as a *different*, more privileged role than the application. Supabase hands you an owner-level connection string by default, and Drizzle migrations use it.

Without role separation, the revocation either fails to apply or applies to the role that migrations run as — and the non-negotiable is decorative.

**Fix.** Phase 0 provisions a restricted `ahp_app` runtime role distinct from the migration owner; the application connection string uses `ahp_app`. Verified by a test that attempts an `UPDATE` on `audit_logs` as `ahp_app` and asserts it is refused.

### B4. Access-tier enforcement has no named layer

The application connects over Hyperdrive as a privileged role, so Postgres RLS is not in play at all. Every gate in §8A3 — `patient_summary` access, referral claiming, the two verification tiers — is therefore application code. The plan states the rules thoroughly and never says where they live.

Scattered checks are how a rule this important gets missed on exactly one code path.

**Fix.** One server-side module exposing `can(user, action, resource)`; every route handler and server action funnels through it. A test asserts there is no read path to `patient_summary` that does not pass through it. Record the deliberate decision *not* to use RLS, with the reason — a half-applied RLS policy is worse than none, because it reads as protection that isn't there.

### B5. `verification_stage` has two sources of truth

§8A1a describes the stage as "computed off approved `credentials` rows," but it is a stored column on `users`. Two things that must agree, with no named mechanism keeping them in agreement.

The credential-expiry flow makes this concrete: §8A describes the public badge being removed and referral claiming suspended after the grace period, without ever saying which column changes. As written, an expired credential leaves `verification_stage = 'credentials_verified'` sitting in the database.

**Fix.** A single `recompute_verification_stage(user_id)` database function, called only from the admin approve/reject action and the expiry job — nothing else writes the column, which is exactly what the "only ever written by a human admin action" non-negotiable requires. A nightly reconciliation query alerts on drift. The IAP-exclusion test (the rule most likely to be quietly violated later) is written against the function, not against its callers.

### B6. `notifications` and `notification_outbox` are two tables for one concern

§8G declares `notifications`, used by §8A3's email drip. §8D declares `notification_outbox`, used by the referral engine. Two write paths for one concern, with the transactional-outbox discipline applying to only one of them.

**Fix.** `notification_outbox` becomes the single write path for everything that sends. Keep `notifications` only if a user-facing notification history is actually wanted — and if so, populate it from the outbox rather than in parallel with it.

### B7. Area hierarchy matching needs a path column

Two separate features traverse the `areas` tree: matching ("`area_id` matches or falls within their `home_visit_areas`") and the empty-pool parent-zone fallback. Both mean recursive traversal on every referral post, against a curated table of roughly 150 rows across four levels.

**Fix.** An `ancestor_ids UUID[]` column maintained on insert. Matching and fallback both collapse to array containment, which is indexable and trivially testable. At this table size the maintenance cost is nil.

### B8. Public-directory contact reveals have no table

§9 requires that every reveal be logged and rate-limited per IP. `contact_reveals` is direct-mode only and dormant for the entire pilot; §8D is explicit that relay mode writes no row there. So the reveal logging §9 mandates has nowhere to go.

**Fix.** `profile_contact_reveals`, distinct from the dormant direct-mode table — different actor (an anonymous public visitor), different data, different retention. Rate limiting via Postgres at pilot volume; Cloudflare KV correctly stays P1.

### B9. The encryption envelope has no call site in the pilot

§5's versioned envelope is well-designed and its "unfixable later" reasoning is correct. But at pilot: relay mode collects no patient phone number, `contact_reveals` is dormant, and `users.email` is explicitly excluded by the section itself. There may be no encrypted field at all.

That is fine — but it must be decided, not discovered. The honest candidate is `users.public_contact_value`, and finding out after launch that it should have been enveloped is exactly the retrofit §5 says is impossible.

**Resolved — E2.** Encrypt `users.public_contact_value`, the one field at pilot meeting §5's criterion. The key lives in Cloudflare Workers Secrets.

### B10. Metabase is not free

§7 and §8G6 treat Metabase as zero-cost because it is open source. Self-hosting it needs a container host, which Workers is not — so it means a real monthly bill and a second operational surface, inside a plan whose central premise is a genuinely free tier through the pilot.

The tool choice is sound. The cost framing is what needs correcting.

**Resolved — E3.** Metabase deferred; the restricted role and PII-excluding views built in Phase 0 regardless.

### B11. `therapist_skills.verification_status` is a third verification concept with no pipeline

The column offers `'unverified' | 'pending' | 'verified'`, with no queue, no admin action, and no gating logic anywhere in the plan that reads it. A third verification vocabulary alongside `credential_status` and `verification_stage` invites exactly the badge confusion §1A works hard to prevent.

**Fix.** The pilot ships `'unverified'` only. Build no path that writes anything else, and no surface that displays it.

### B12. Supabase Auth to `users` sync is unspecified

Supabase Auth owns `auth.users`; the application owns `users`. Nothing says how a row appears in the second when someone signs into the first — and `auth_identities` (§8A) needs populating at the same moment.

**Fix.** `users.id` equals `auth.users.id`. The row is created by a server action on first sign-in rather than a database trigger — it needs to set `account_type` and `is_founding_member`, and a server action is testable and debuggable in a way a trigger is not. The same action upserts `auth_identities`.

---

## C. Product and design findings

### C1. The verified-only filter defaults on, which strands the tier the plan just invented

§9 defaults "Credentials verified only" to on for the public-facing directory. But §10C promises an unverified profile is "live, listed, appears in directory search," and §8A1a gives `qualification_confirmed` its own directory ranking tier between Verified and Unverified.

With the filter on by default, that middle tier is invisible to the public audience it was created for. Two-tier verification exists specifically because most practicing physiotherapists cannot yet reach the top tier — and the default filter hides exactly those people.

**Resolved — E4.** The filter defaults off; ranking carries the distinction.

### C2. Clinic referrals contradict the product frame

The table is `home_case_referrals`. §8D2 and §11 are written around home-based care. §1C's third gate for admitting a new profession is home-visit practice norms. Yet §8D's matching filter routes clinic-visit referrals whenever `home_visit_required = false`.

Either clinic referrals are in scope — in which case the table name and the framing throughout should say so — or `home_visit_required` is always true at pilot and the clinic branch is dead code shipped into the most safety-sensitive query in the product.

**Resolved — E5.** Both visit types ship, and the field loses its default — the choice becomes explicit at post time.

### C3. The three badges are the most safety-critical UI in the product and must be built once, early

"Credentials Verified," "Qualification Confirmed," and "Ownership Verified" carry genuinely different claims and must never be rendered as or confused with each other (§1A, §8C3). They will be consumed by the directory, profile pages, referral cards, the activity feed, and the admin queue.

**Fix.** One locked component module built in Phase 1, before any surface consumes it, carrying the verbatim §1A tooltip copy inside it and covered by a visual-regression snapshot. Tooltips must be tap-accessible rather than hover-only — this is a mobile-first product and the disclaimer is load-bearing, not decorative.

### C4. Make the no-ranking rule mechanical, not disciplinary

It is the plan's most-repeated non-negotiable and the easiest to erode one well-meaning string at a time — "top therapists in Kondapur" is a natural thing to write and a violation.

**Fix.** A test scanning all user-facing copy for `rating|score|star|rank|top|best` and failing the build on a hit outside a reviewed allowlist. The same shape for the footer-legal gate (§1B): a test asserting those `href`s stay empty until counsel delivers, and that the grievance address stays unpublished while `grievance_channel_published` is false. Both rules are stated as absolute; a test is what makes them absolute.

### C5. Centralise user-facing copy

The plan specifies exact wording in §1A, §8D2, §10D, §10E, §10G, and §8D's display table — several pieces of which are legally load-bearing and pending counsel review.

**Fix.** One `copy.ts` holding all of it plus the `CONSENT_TEXT_VERSION` constant. A counsel review becomes a single file diff, and `consent_text_version` bumps become mechanical rather than something to remember.

### C6. The display-wording layer should be a pure function

§8D explicitly requires the plain-language wording stay separate from the internal state enum. That separation survives only if it has a home.

**Fix.** `displayFor(state, viewerRole)` returning label and sub-label, with a snapshot test covering every row of §8D's table — not ternaries spread across components, which is how the two layers quietly re-merge.

### C7. Three shared components carry the whole app and are currently owned by no phase

- **The area selector** — grouped tappable chips, zero network calls, ~150 curated rows. Used by home-visit areas (Phase 1/2), referral posting (Phase 6), and directory filters (Phase 5).
- **The chunked form primitive** — save-on-blur, cancellable and resumable upload, the compression-failure fallback §7 specifies. Used by onboarding, credential upload, practice creation, and referral posting.
- **The badge set** — C3 above.

Each is implied by several phases and owned by none, which is how three slightly different versions get built.

**Fix.** Explicit phase ownership in `BUILD_SEQUENCE.md`: badges and the form primitive in Phase 1, the area selector in Phase 2.

### C8. Empty states are a first-class deliverable at 25–30 users

§10D's never-a-bare-zero rule, the new-member cards, and the activity feed's density problem are three faces of one thing: at pilot density, the empty state *is* the product for most people on most days.

**Fix.** Every surface ships its empty state in the same change as the surface, reviewed against §10D's rule. Not a fallback to add later — at 25 users it is the common case.

### C9. Ops load is the real project risk

§8A2 budgets 10–15 hours per week of admin work — verification, curation, empty-pool calls, deadline follow-up — for a solo founder who is also the sole developer. Nothing in the build sequence reduces it, and it competes directly with the development time the plan's own fifth hosting trigger is worried about.

**Fix.** Front-load the quality of the pre-filled review screen in Phase 3 — it is the single thing that turns 12 minutes per document into 8, across the highest-volume recurring task. Pull basic ops visibility earlier than Phase 10, even as saved SQL, so supply gaps and queue depth are visible during the pilot rather than after it.

---

## D. What is right and should not be touched

Recorded so a later pass does not relitigate it:

- **Relay-only pilot scope**, and the honesty about what it costs in observability (§11).
- **The 2-slot shortlist race**, with patient details hidden until acceptance — reconsidered against a proposal to revert to sequential and correctly rejected.
- **Never auto-approving credentials at any confidence score**, and scoring that only prioritises the queue.
- **Hand-curated `master_councils`**, held to a different standard than `master_institutions`, for a stated and real reason.
- **Auto-enrolment restricted to workplace communities**, with membership derived from a view so it can never drift.
- **The transactional outbox** — notifications never sent inline in a transaction.
- **Invites with no reward layer**, rejected outright rather than deferred, with the reasoning about small-cohort trust.
- **The rejection of ratings, streaks, daily-check-in rewards, and "last login"** as engagement signals.

These are the decisions that make the product defensible. The reasoning recorded for each is sound.

---

## E. Decisions — all five resolved

Recorded with their reasoning rather than reduced to a verdict: the value of this section is *why*, and a decision whose reasoning survives is one that does not get quietly reopened in three months. Treat these as made. If one looks wrong later, raise it with the founder — do not revisit it unilaterally.

### E1 — UI stack: **Tailwind CSS + shadcn/ui** *(unblocked Phase 1)*

Components are copy-in source living in the repo, not a runtime dependency — which matters on Workers, and follows the same reasoning §7 used to choose OpenNext over `vinext`: for a solo build leaning on Claude Code, the option with the most existing troubleshooting precedent wins over the more elegant one.

A token layer is established in Phase 0 before any screen is built on it, carrying one hard constraint from C3: **the three verification badges must be distinguishable by shape and icon and text, never by colour alone.** That is an accessibility requirement and a §1A trust requirement simultaneously, and it belongs with the tokens rather than in a component comment.

### E2 — the encryption envelope protects **`users.public_contact_value`** *(unblocked Phase 1 schema)*

The one live field at pilot meeting §5's own criterion — personal contact information never used as a lookup key. Relay collects no patient phone, `contact_reveals` is dormant throughout, and §5 excludes `users.email` itself, so without this §5 would have shipped as a section with no call site.

**What it buys, stated honestly:** protection against database compromise, not against disclosure — the value is revealed publicly on tap by design. That is what encryption at rest is for, and the section should not imply more. Cost is one decrypt per reveal and one on profile edit.

**Resolved alongside it:** §5's key-location question, which pointed at a spike that has since happened. The Worker performs the encryption, so the key is a secret in Cloudflare Workers Secrets. Supabase Vault applies only if a specific job later moves into an Edge Function — a per-job decision, not the default.

A second encrypted field is now a deliberate act rather than drift.

### E3 — Metabase **deferred; the restricted role and analytics views built now** *(unblocked Phase 10, and corrected a claim that was untrue today)*

v18 called Metabase free because it is open source. It needs a container host with roughly 2GB of RAM, which Workers is not — so it meant a real monthly bill and a second operational surface inside a plan whose central premise is staying genuinely free through the pilot. §12's metrics run as saved queries during the pilot, which is what v17 already planned; Metabase arrives when ops load justifies the cost.

**The more important half is what gets built now.** §8G5 requires admin reads of patient contact data to be audited, and a BI tool connected straight to Postgres bypasses `audit_logs` entirely while reading every column it can see. So Phase 0 creates an `analytics` schema of read-only views and a third database role (`ahp_analytics`) with access to those views only — never base tables. The views exclude `patient_summary`, `location_address`, `urgency_reason`, `public_contact_value`, `legal_name`, `email`, `credentials.ocr_extracted_json`, `registration_number`, `document_url`, `feedback.message`, and `audit_logs.before_state`/`after_state`. Nothing in §12 needs any of them; every metric there is an aggregate, a status, a foreign key, or a timestamp.

Doing this before the tool exists is the whole point. Retrofitting a restricted surface onto a BI tool already pointed at the raw database does not happen once the dashboards work.

**§8G6's architecture is unchanged** — custom-built write actions, a BI tool for read-only monitoring. Only the tool's arrival moved.

### E4 — the verified-only directory filter **defaults OFF** *(unblocked Phase 5)*

v18 defaulted it on for the public directory, which hid every `qualification_confirmed` profile from patients — the exact audience §8A1a invented that tier for, since most practicing physiotherapists cannot yet reach the top tier — and contradicted §10C's promise that an unverified profile is "live, listed, appears in directory search."

§9's ranking already orders Credentials Verified above Qualification Confirmed above Unverified. The distinction is carried by that ordering and by the badge on each card, which is where a trust signal belongs; a searcher who wants only the top tier turns the filter on.

### E5 — **both visit types, explicitly chosen** *(unblocked Phase 6 matching)*

Clinic referrals stay in scope — a therapist with a full caseload referring a patient who will attend a clinic is a real case, not a scope error. But `home_visit_required` loses its `DEFAULT false`: as written, a referral posted without touching the field was a clinic referral, in a product whose stated premise is home-based care. That is a column default quietly answering a product question.

The posting form makes visit type a **required, un-preselected choice** — the same discipline §8D2 applies to the consent checkbox, for the same reason: it decides who gets notified, so a pre-filled answer is not an answer.

The table keeps the name `home_case_referrals`. Renaming touches every reference for no behavioural gain.

---

## F. Still genuinely open — two real-world facts

Neither is a build task, and neither is resolved by this document:

- **TGPMB's actual registration function** — confirm it covers post-qualification professional registration for practicing physiotherapists, not just paramedical course admissions, before it is seeded into `master_councils`. **Blocks Phase 2.**
- **The interim legal documents' placeholders** — `FOUNDING_MEMBER_DECLARATION.md` and `INTERIM_PRIVACY_NOTICE.md` still carry `[founder's email/phone]` and `[date]`. **Blocks onboarding real people; no build phase.**
