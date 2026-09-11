# Referral Loop & Outcome Tracking — Spec Addendum to ahp-network-plan-v19.md

**Status:** A new capability layered on §8D's referral engine — closing the loop *after* a referral is accepted, so a patient isn't lost at handover. Written against the existing, working build (`open → shortlisted → accepted → contact_acknowledged → completed`, three PL/pgSQL transition functions, the `referral_events` audit trail). Every decision below was settled in a founder review; treat them as made, not as options.

**How to use this file (for whoever/whatever is executing it):**

1. **Audit first, build second.** §1 records what was verified against the live code at the time of writing. Re-check before building — some of it may have moved.
2. Sections are tagged **[SCHEMA]**, **[LOGIC]**, or **[UI]**. A section with no tag is a constraint or a decision record, not a build item.
3. **This adds no new referral status and changes no existing transition.** §8D's state machine, its status `CHECK`, and the three PL/pgSQL functions (`shortlist_referral`, `accept_referral`, `lapse_offers`) are untouched. If an implementation appears to require changing any of them, stop and flag it rather than proceeding.
4. §0 is a product boundary, not a build item. Nothing on the "never build" side of it should be built under any future request without that boundary being revisited explicitly first.

---

## Summary — schema deltas at a glance

| # | Change | Table | Type | Risk |
|---|---|---|---|---|
| §3 | new table `referral_status_updates` | new | Additive | None — nothing reads it until §10's UI ships |
| §2 | `CONSENT_TEXT_VERSION` 1 → 2, reworded consent text | `copy.ts` (no column change) | Copy + logic | Low in code, but **blocks** all prose capture until done |
| §8 | one new rule in the §8H retention matrix | `retention.ts` | Logic | None — extends the existing daily job |

**No changes to:** `home_case_referrals` columns or its status `CHECK`, the three referral PL/pgSQL functions, referral matching (§8D), verification gating, `contact_mode`, or any locked P0 mechanic.

---

## 0. Product boundary — read this before building anything below

§1 of the main plan:

> *"AHP Network owns identity, verification, discovery, referrals, recruiting, networking. Thera.Net Clinic owns clinical workflow, EMR, documentation."*

This feature deliberately walks up to that line. What is being built is **referral-loop closure** — did the handover work, is the patient still being seen, and if not why — **not clinical documentation**.

**Never build, in this or any future iteration of this feature:**

- Session-by-session notes, treatment plans, or progress charting
- Structured clinical fields of any kind (ROM, VAS, outcome measures, goals)
- File or document attachments (see the rejected list at the end)
- Two-way messaging between the two therapists (see §5)
- Anything a clinician would reasonably describe as "the record"

The single free-text field specified in §4 exists to carry a short handover summary in the same de-identified register the `patient_summary` field already uses, and is bounded and gated accordingly. "Lightweight clinical notes" is the exact thing this boundary exists to prevent — it has a way of becoming full-featured after the first follow-up request.

---

## 1. Findings from an audit of the current build

Verified directly against the code, not assumed. Re-check before building.

| Check | Finding |
|---|---|
| Referral statuses | `open, shortlisted, accepted, contact_acknowledged, completed, cancelled_by_poster, expired` — **no outcome data exists anywhere.** `completed` is a bare terminal state |
| `referral_events` | A transition audit trail (`event_type`, `payload`, `actor_user_id`) — **not** an outcome record. Do not overload it to carry patient outcomes |
| Consent text | `REFERRAL_CONSENT_TEXT` covers contact details flowing *to* the accepting therapist, once. Silent on any reporting flowing *back* |
| `CONSENT_TEXT_VERSION` | Currently `1`; written to `home_case_referrals.consent_text_version` as a string at post time |
| `patient_summary` guardrail | `PATIENT_SUMMARY_PLACEHOLDER` + `PATIENT_SUMMARY_WARNING` already exist in `copy.ts`. Reuse that exact pattern — do not invent a second guardrail vocabulary |
| Encryption | `users.public_contact_value` is the only encrypted field. `patient_summary` is **not** encrypted — this matters for §9 |
| Matching inputs | `users.role`, `users.specializations`, `users.accepting_referrals`, visit-type and area columns. Unaffected by anything here |

---

## 2. Consent — must land before any prose capture `[LOGIC]`

Current `REFERRAL_CONSENT_TEXT`:

> *"I confirm the patient has agreed to be referred to another allied health professional through AHP Network, and understands their contact details are shared only with the accepting therapist, never the platform."*

**The gap.** That consent covers contact details moving outward, once, to one named recipient. It does not cover the accepting therapist writing the patient's clinical progress *back* to the referrer, nor that text being stored on the platform. Note the second half carefully: the current sentence promises contact details reach *"never the platform."* A handover note **is** stored on the platform. These are different data with different handling, and the reworded text must keep that distinction sharp rather than blurring it into a single vaguer promise.

**Required:**

- Reword to add the progress-reporting purpose, preserving the contact-details promise as a separate clause.
- Bump `CONSENT_TEXT_VERSION` from `1` to `2`.
- Fold into the interim legal documents task — already the named blocker on onboarding real people. This is **not** a copy tweak; it changes what patients are agreeing to.

**Version gating — do not skip this.** A referral posted under consent version `1` must never accept a free-text note. Enum-only outcomes (`could_not_reach`, `first_session_done`, etc.) are acceptable on a v1 referral because they record only whether the handover worked. Prose requires v2 consent. Enforce this in the authz check (§7), not in the UI — a UI-only guard is not a consent control.

---

## 3. Schema `[SCHEMA]`

```sql
CREATE TABLE referral_status_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES home_case_referrals(id),
  reported_by_user_id uuid NOT NULL REFERENCES users(id),
  outcome text NOT NULL,
  note text,
  discontinued_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,

  CONSTRAINT referral_status_updates_outcome_check CHECK (
    outcome IN ('could_not_reach','contacted_not_started','first_session_done',
                'ongoing','completed_discharged','discontinued','not_suitable_referred_on')
  ),

  -- A reason is required for, and only for, a discontinuation.
  CONSTRAINT referral_status_updates_reason_required_check CHECK (
    (outcome = 'discontinued') = (discontinued_reason IS NOT NULL)
  ),

  CONSTRAINT referral_status_updates_reason_values_check CHECK (
    discontinued_reason IS NULL OR discontinued_reason IN
      ('switched_therapist','not_responding','cost','travel_distance','improved',
       'mismatch','not_comfortable','medical_reason','relocated','other')
  ),

  -- Free text only exists on the outcomes that earn it (§4).
  CONSTRAINT referral_status_updates_note_check CHECK (
    note IS NULL OR outcome IN
      ('ongoing','completed_discharged','not_suitable_referred_on','discontinued')
  )
);

CREATE INDEX referral_status_updates_by_referral
  ON referral_status_updates (referral_id, created_at)
  WHERE deleted_at IS NULL;
```

**Conventions applied:**

- **`TEXT` + `CHECK`, never Postgres `ENUM`** — both lists are expected to grow, and `CHECK` constraints migrate inside a transaction with other schema changes while `ENUM` alterations cannot.
- **Stable keys stored, display words in `copy.ts`** — so any label can be reworded without a migration.
- **It is a timeline, not a column.** A case genuinely moves `first_session_done → ongoing → completed_discharged`. The latest row is current state; the sequence is the actual value of the feature. This is why it isn't a single `outcome` column on `home_case_referrals`.
- **Soft delete, not hard** — consistent with §8H throughout.

---

## 4. Outcomes, and what each one can carry `[LOGIC + UI]`

| `outcome` | Display label | Free text |
|---|---|---|
| `could_not_reach` | Couldn't reach patient | none |
| `contacted_not_started` | Contacted, not started | none |
| `first_session_done` | First session done | none |
| `ongoing` | Ongoing | handover note |
| `completed_discharged` | Completed / discharged | handover note |
| `not_suitable_referred_on` | Not suitable — referred on | short note (why) |
| `discontinued` | Discontinued | reason required, + short note on **Medical reason** and **Other** only |

### The handover note field

- **Reuse `patient_summary`'s exact guardrail pattern.** A placeholder in the same de-identified register (`"e.g. 65M, s/p knee replacement, needs regular home PT"` is the existing model), and the same warning: *don't include name, phone number, or exact address.* Both live in `copy.ts`.
- **~500 character cap.**
- **Labelled "Handover note to the referring therapist" — never "clinical notes."** The label decides what people write. "Clinical notes" invites an assessment; "handover note" invites a summary. This is the cheapest and most effective control in the whole document.

### Discontinued reasons

Display order by expected frequency, `Other` last. Labels are deliberately one to two words — this is a dropdown scanned in a hurry, not prose.

| Key | Label | Note field |
|---|---|---|
| `switched_therapist` | Switched therapist | — |
| `not_responding` | Not responding | — |
| `cost` | Cost | — |
| `travel_distance` | Travel/distance | — |
| `improved` | Improved | — |
| `mismatch` | Mismatch | — |
| `not_comfortable` | Not comfortable | — |
| `medical_reason` | Medical reason | short note |
| `relocated` | Relocated | — |
| `other` | Other | short note |

**`mismatch` and `not_comfortable` are deliberately both present** and are not duplicates: the first is a neutral statement about fit (approach, schedule, communication style), the second is the patient's own discomfort. Neither assigns fault, which matters because the referring therapist reads this about a colleague they personally chose.

**`medical_reason` carries the fuller meaning — hospitalised, or the condition changed — as helper text under the dropdown**, not inside the option label.

---

## 5. The channel is deliberately asymmetric `[LOGIC + UI]`

**The receiving therapist writes. The referring therapist acknowledges. There is no reply box.**

The value this feature exists to deliver is *status without conversation* — it protects a therapist who doesn't want a WhatsApp thread with someone they've never met, and it is the reason the loop can close at all without exchanging personal contacts. Free text flowing in both directions is chat, which reintroduces exactly the contact surface relay-only mode (§8D) exists to avoid.

- The accepting therapist may post status updates voluntarily, at any time after handover.
- The referring therapist may send **one canned nudge** — *"Any update on this patient?"* — at most **once per referral per 14 days**. No free text, no body, no reply.
- **Never build:** threaded replies, a message body on the nudge, read receipts, or any indicator that turns this into a conversation.

---

## 6. Prompts and delivery `[LOGIC]`

**In-app only for now.** Push and email are deferred pending a separate founder decision on notifications generally.

- A **single** in-app prompt to the accepting therapist roughly 7 days after `accepted`, surfaced on the referral detail page and on Home. Not a sequence — §G already settled that at 25–30 users a human following up beats a notification ladder, and that at most two of §8D's seven timers are ever user-visible.
- If push/email is added later, it writes to `notification_outbox` and is delivered by the existing worker — **never sent inline inside a transaction** (CLAUDE.md non-negotiable).
- The 7-day check is day-scale: **fold it into the existing daily cron route** rather than requesting a 6th Cloudflare Cron Trigger. The account's five are fully used. Same precedent as the credential-expiry job, which was folded into the daily retention route for exactly this reason.

---

## 7. Visibility and authz `[LOGIC]`

Everything routes through `can(user, action, resource)`. No route handler or server action reads these rows directly — CLAUDE.md non-negotiable.

| Actor | May |
|---|---|
| Accepting therapist | insert updates; soft-delete their own rows |
| Referring therapist (poster) | read all updates on their own referral; send the canned nudge |
| Other shortlisted therapists | nothing |
| Receiver's practice colleagues | nothing |
| Community members | nothing, ever |
| Admins | read — **always** with an `audit_logs` entry (§8G5 already requires this for admin reads of patient data) |

New authz actions: `report_referral_outcome`, `read_referral_outcome`, `nudge_referral_outcome`.

**Eligibility to report:** only the therapist whose `referral_interest` row is `accepted`, and only once the referral has reached `contact_acknowledged` or `completed` — i.e. after the handover actually happened. A therapist who merely expressed interest has no patient to report on.

---

## 8. Retention `[LOGIC]`

- **`note` purges on the same 90-day clock as the referral's contact fields** (§8H). The existing daily retention job gains one rule; do not add a second schedule.
- **`outcome`, `discontinued_reason` and timestamps persist.** They are not patient-identifying and they carry §11's metrics.
- **Add this as an explicit row in §8H's table-by-table matrix** rather than relying on a note in this document. That matrix is the source of truth for retention, and it varies table to table by design.
- **Soft delete for author retraction.** The row stays for audit; `referral_events` records the retraction.

---

## 9. Decided: not encrypted `[LOGIC]`

CLAUDE.md: `users.public_contact_value` is the pilot's one encrypted field, and *"a second encrypted field is a deliberate decision, not drift."* This is that decision, and for the pilot the answer is **no**.

**Reasoning, preserved so it isn't quietly reopened:** `patient_summary` already holds comparable clinical content, unencrypted. Encrypting the handover note while leaving `patient_summary` in the clear protects nothing — anyone with database access reads the unencrypted one. The two would have to be encrypted together or neither. Both carry the same de-identification guardrail (§4), and that guardrail — not encryption — is what actually bounds the exposure.

Revisit only if either field is ever permitted to hold identifying detail, in which case both change together.

---

## 10. History views `[UI]`

Extends `/app/referrals`, which already splits *Posted by you* / *Matched to you*.

- **Referrals I raised** — each row shows the latest outcome; opening one shows the full timeline.
- **Referrals I received** — the mirror, carrying the report-status action.
- **Neither view shows any rate, score, percentage, or comparison.** A "completion rate" is the same forbidden class as the public response-time metric the profile-card addendum explicitly rejected, and the same no-ranking rule covers both.

---

## 11. Metrics `[LOGIC]`

- **Discontinuation reasons aggregate into the §8G6 analytics views.** `cost` and `travel_distance` are genuine market signals, and being able to count them is the main reason the reason is a dropdown rather than prose.
- **`note` text must be excluded from every analytics view** — those views exclude PII by construction, and this is the most sensitive free text in the system.
- **§10H's private reciprocity stat becomes truthful.** "You've helped connect N patients" can be grounded in `first_session_done` rather than mere acceptance. It stays first-person and private — never comparative, never shown to anyone else.

---

## 12. Tests

Real Postgres, no mocks — the standing convention.

- **authz:** a non-accepting therapist cannot report; the poster cannot report; an admin read writes an `audit_logs` row
- **CHECK constraints:** a note is rejected on `could_not_reach`; `discontinued` without a reason is rejected; a reason without `discontinued` is rejected
- **consent gating:** a referral posted under `CONSENT_TEXT_VERSION = 1` rejects a note but accepts an enum-only outcome
- **nudge rate limit:** a second nudge inside 14 days is refused
- **retention:** the note purges at 90 days while the outcome survives
- **copy:** every outcome key and every discontinued-reason key has a label in `copy.ts`

---

## Explicitly rejected / deferred, with reasoning preserved

- **Document/file attachments (the Doximity model)** — deferred, not rejected. A PDF in R2 means arbitrary clinical content, object-level access control, its own encryption and retention decisions, and the S3-compatible-API discipline — a large new surface for perhaps 15% more value than a bounded note. Revisit only once the text loop has proven it gets used.
- **Two-way messaging** — rejected outright. See §5; it would undo relay-only contact mode.
- **Structured clinical fields** (ROM, VAS, outcome measures, treatment plans) — rejected. See §0.
- **Changing `home_case_referrals.status` on a terminal outcome** — rejected. The outcome timeline is a separate dimension from §8D's state machine; conflating them would mean editing locked transition logic to serve a display concern.
- **Push/email prompts** — deferred pending the founder's separate decision on notifications. In-app only until then.
- **Any public completion rate, responsiveness score, or reliability metric** — rejected, same class as the profile card's rejected response-time metric, covered by the same §1A no-ranking rule.
