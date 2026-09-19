# Interim Data & Privacy Notice

**This is not a legal document.** It's a plain-language explanation of what
data AHP Network collects, why, and what happens to it — written by the
founder, for the founding-cohort pilot, until a proper Privacy Policy
exists (see the note at the bottom for why that hasn't happened yet). Read
this alongside the [Founding Member Declaration](./FOUNDING_MEMBER_DECLARATION.md).

## What we collect

- **Your profile:** name, role (physiotherapist / occupational therapist /
  speech-language pathologist), specializations, practice/workplace
  details, and the public contact detail you choose to show.
- **Your credential documents:** council registration certificates,
  degree/qualification documents, and similar, uploaded by you so an admin
  can verify them. These are processed once through Google Cloud Vision
  (an OCR service) purely to help our admin team review them faster —
  OCR results never auto-approve anything; a human always makes the
  verification decision.
- **Referral activity:** referrals you post or accept, and — only after a
  referral is accepted, and only with the patient's consent recorded at
  that point — the patient contact detail you provide, so the accepting
  therapist can reach them.
- **Basic usage data:** the kind of thing any web app logs (page requests,
  errors) to keep the platform working and find bugs.

We do **not** collect structured clinical data about patients. The
"patient summary" field on a referral is a short free-text note (e.g.
condition and care need) — you're told explicitly not to put a patient's
name, phone number, or address in it.

## How referrals and patient contact details work

AHP Network currently runs **relay-only contact mode**: when a referral is
accepted, the patient's contact detail is shared with the accepting
therapist so they can reach out directly. AHP Network doesn't route the
call, doesn't sit in the conversation, and doesn't keep a copy of that
contact detail anywhere it can be casually read — it's stored encrypted,
and access to it is logged.

## What we don't do

- **No ranking, scoring, or star ratings — anywhere, on anyone.** Your
  profile shows verification status (what a badge means is explained on
  the badge itself), never a score or comparison against other
  professionals.
- We don't sell your data, and we don't share it with anyone outside the
  specific, narrow purposes above (verifying you, running a referral you
  chose to take part in).
- We don't use your data to train third-party AI models.

## Where your data lives

Profile and referral data is stored in a Postgres database (Supabase,
hosted in Mumbai). Credential documents are stored in Cloudflare's object
storage (R2). Both are access-controlled; admin access to sensitive data
(like a referral's patient contact detail) is logged, not just the ability
to change it.

## Your rights

Even before formal DPDP (India's Digital Personal Data Protection Act)
compliance processes are fully built out, you can:

- **Ask what data we hold on you.**
- **Ask us to correct it.**
- **Ask us to delete your account.** Some data (like audit logs of past
  admin actions, or referral records another professional's care depended
  on) is retained or anonymised rather than hard-deleted, depending on
  what it is — we'll tell you specifically what happens to your data if
  you ask.

To do any of this, contact the founder directly — see below. There isn't
yet a dedicated, published grievance-officer inbox separate from this; that
gets set up and published once someone is actually assigned to check it
regularly, per DPDP's expectation that a grievance channel actually gets a
response, not just exist.

- Email: `theranetconnect@gmail.com`
- Phone: `9032323890`

## Why this document exists instead of a real Privacy Policy

TheraNet Technologies is deliberately staying unregistered, and formal
legal counsel is deliberately not yet engaged, for as long as this stays a
small, unmonetized Hyderabad pilot — a founder decision, not an oversight.
This notice is the honest, temporary bridge for that period, describing
current practice accurately rather than promising more than is actually
built. It will be replaced in full, not patched, once the real Privacy
Policy exists.

---

*Version 1 — dated `01/10/2026`. Effective for founding-cohort members from
that date. Superseded in full when TheraNet Technologies' formal Privacy
Policy is published.*
