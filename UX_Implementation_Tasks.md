# Implementation Tasks

- [ ] **Phase 1: Database & Verification Schema Updates**
  - [ ] Implement `recompute_verification_stage` DB fix (Statutory Registration independently grants `credentials_verified`).
  - [ ] Generate `0025_seed_hyderabad_full.sql` using All India Pincode Directory.
  - [ ] Add `curation_status` column to `areas` table (`approved` | `pending_review`).

- [ ] **Phase 2: Admin Dashboard & Global Nav**
  - [ ] Add "Review Areas" queue to Admin Dashboard.
  - [ ] Update Global Top Nav (Home | Referrals | Directory | Communities | Practices).
  - [ ] Add `lucide-react` icons to Top Nav.

- [ ] **Phase 3: Onboarding & Verification UI**
  - [ ] Add "Top Specialties" and "Accepting Patients" toggle to Onboarding Step 2.
  - [ ] Build "Suggested Connections" UI for Onboarding Step 2.5.
  - [ ] Make "Upload Credential" the massive primary CTA on Step 3.
  - [ ] Redesign Credential Upload form (Visual Cards, Fast Track Banner, Multi-upload).

- [ ] **Phase 4: Dashboard & Profile Overhaul**
  - [ ] Refactor Dashboard to 2-column grid (`md:grid-cols-3`).
  - [ ] Move "Circles Manager" to Profile dropdown.
  - [ ] Emphasize "Refer Patient" CTA on public profiles.
  - [ ] Apply 15-member strict cap to Circles logic & UI.

- [ ] **Phase 5: Referral Board & Targeting**
  - [ ] Implement Referral Board Tabs (`Matched to Me`, `My Posts`, `Explore Network`).
  - [ ] Unify "First Look" Targeting (Simultaneous Circle + Community targeting).
  - [ ] Add `expand_to_network` DB toggle and UI switch.
  - [ ] Add "Extend Time" (+12h/+24h) and "Re-Offer" actions to Poster Dashboard.
  - [ ] Implement dynamic Offer Expiry (2h Urgent, 12h Routine).
  - [ ] Update `referral-scheduler.ts` to pause expiry timers between 10 PM and 7 AM.

- [ ] **Phase 6: Case Brief Refinements**
  - [ ] Implement "All-Clear" Toggle for Precautions.
  - [ ] Add Quick-Insert Tags (`[Weight-Bearing]`, `[ROM Limit]`, etc.) to Precautions field.
  - [ ] Add "Primary Goal / Expected Outcome" field.
  - [ ] Split `preferredContactWindow` into Method dropdown and Time text input.
  - [ ] Increase character limit for history fields to 1,000.

- [ ] **Phase 7: Directory & Communities**
  - [ ] Build Dynamic Omni-search bar with `useTransition`.
  - [ ] Add horizontal Quick Filters to Directory.
  - [ ] Remove "Connect" CTA from Directory list cards.
  - [ ] Implement "Pledge to Unlock" UI for Communities.

- [ ] **Phase 8: Practices**
  - [ ] Elevate Practices to Main Navigation.
  - [ ] Implement 2-way consent logic for Practice Employees.
  - [ ] Move "Invite to Practice" exclusively to Practice Management Dashboard.
  - [ ] Enhance Practice Profile (Operating Hours, Owner check, Contact info).

- [ ] **Phase 9: Administrative & Security Polish**
  - [ ] Build "Vacation Mode" auto-decline functionality.
  - [ ] Implement Granular Notification Matrix (Email vs Push per event type).
  - [ ] Add Security Audit Log ("Recent Login Activity") to settings.
  - [ ] Add SLA Color-Coding to Admin Dashboard queues.
  - [ ] Build Checkbox Bulk-Actions (Approve/Reject) for Curation Queues.
  - [ ] Build secure `Impersonate User` feature for Super Admins.
