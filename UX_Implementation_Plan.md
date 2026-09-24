# Full App Refining & Review Plan

This plan outlines the layout, UX, workflow, and underlying schema improvements across the core sections of the app (Dashboard, Referrals, Directory, Communities, Practices, Circles, Onboarding, and Verification).

## User Review Required

- **Dashboard**: Transitioning to a two-column grid.
- **Referral Board**: Tabbed interface (`Matched to Me`, `My Posts`, `Explore Network`) with Filters.
- **Directory**: Dynamic Omni-search bar and horizontal quick-filters. Removing "Connect" from list cards.
- **Communities**: Introducing the "Pledge to Unlock" model.
- **Practices**: Adding to main navigation, moving "Invite to Practice" into the dashboard, implementing 2-way consent notification flows.
- **Circles & Profiles**: Emphasizing "Refer Patient" as the primary CTA on profiles, enforcing a strict 15-member limit on Circles. Moving Circles out of main nav into the Profile menu.
- **Onboarding**: Upgrading the initial setup form to capture Specialties and Availability immediately.
- **Verification**: Updating the credential upload form to use Visual Cards and support multi-file uploads, backed by a fixed tier-gating function.

## Proposed Changes

### 1. Global Navigation & Polish
- **Menu Icons**: Add clean `lucide-react` icons next to all main navigation items to improve visual scanning.
- **The New Navigation Bar**: Update the top navigation bar to: **Home | Referrals | Directory | Communities | Practices**. 

### 2. Onboarding & Initial Setup
- **Step 2 (The Form)**: Add a **"Top Specialties (Select up to 3)"** field (using pill tags) and an **"Accepting new patients?"** toggle switch to the initial form. The live Profile Card preview will update instantly to show these tags.
- **Step 2.5 (Connections)**: Upgrade the "X therapists in your area" text screen into a **"Suggested Connections"** screen. Show 3 top therapists in their area to Add to a Circle, and 1 local Community to join.
- **Step 3 (Verification Push)**: Instead of three equally weighted buttons, make **"Upload a Credential & Verify"** the massive, primary CTA. Move "Skip to Dashboard" to a secondary, subtle text link.

### 3. Credential Verification UX & Backend Gating
- **Backend Fix (`recompute_verification_stage`)**: Claude will update the DB function so that an approved Statutory Council Registration *independently* triggers the `credentials_verified` top tier (rather than requiring both a degree AND a registration).
- **The "Fast Track" Banner**: Add a clear instruction at the top of the upload form: *"Fast Track: If you have a valid Council Registration, you only need to upload that. You do not need to upload your degree certificates."*
- **Visual Cards**: Replace the "Document Type" dropdown menu with large, clickable visual cards (`Council Registration` vs `Academic Degree`) so users understand their options immediately.
- **Multi-Upload Support**: Update the file input (`<input type="file" multiple />`) to allow users to upload multiple images at once (e.g., the front and back of a physical registration ID).
- **Dashboard Nudge**: Ensure that if a user skips verification, a persistent warning banner appears on their Dashboard.

### 4. Database & Seeding (Area Coverage & Curation)
- **Full City Coverage**: Claude will generate a new database migration (`0025_seed_hyderabad_full.sql`) using the **All India Pincode Directory** as the source of truth to populate all major localities in Hyderabad under stable, colloquial compass-direction zones (Central, North, South, East, West, Secunderabad) rather than unstable municipal zones.
- **"Request this area" Fallback**: Add a `curation_status` column to the `areas` table (`approved` or `pending_review`). When users can't find their locality during onboarding or posting, they can manually submit an area. This adds it to a `pending_review` queue in an Admin UI (reusing the existing institution curation pattern), ensuring zero silent-wrong-match failures.

### 5. Dashboard (Home)
- **Grid Layout**: Wrap the main content in a 2-column layout (`md:grid-cols-3`).
- **Profile Snapshot Card**: Constant "Directory Preview" card at the top of the sidebar.
- **Setup Checklist**: Disappears completely once 100% complete.

### 6. Referral Board, Targeting, & Timers
- **Tabbed Interface**: Implement `Tabs` (`Matched to Me`, `My Posts`, `Explore Network`).
- **Unified "First Look" Targeting**: When posting a *routine* referral, users can choose to target a Circle, a Community, or **both simultaneously**.
  - Claude will alter `home_case_referrals` to rename circle-first columns to `first_look_window` and `first_look_opened_at`, and add `initial_community_id` and `expand_to_network`.
  - The notify-set will be a unified, deduplicated union of the selected Circle(s) and Community(s) that respects all standard matching filters.
- **Network Expansion Toggle**: Under the First Look pickers, add a toggle (default on, bound to `expand_to_network`): *"If nobody responds in 4h, open this to the wider matched network."*
- **Dynamic Offer Expiry**: Decouple the hardcoded 4-hour `offer_window`. When shortlisting therapists, urgent referrals will lapse in **2 hours**, and routine referrals will lapse in **12 hours**. 
- **Nighttime Timer Pause ("Sleep Hours")**: The backend scheduler (`referral-scheduler.ts`) will be updated to automatically pause expiry timers for referrals between **10:00 PM and 7:00 AM local time**, ensuring therapists are not penalized for sleeping.
- **Offer Extension Actions (New)**: 
  - **Extend Time**: While an offer is pending, the poster gets an `Extend Time` button to manually add 12 or 24 hours to the `offer_expires_at` clock.
  - **Re-Offer**: If an offer fully lapses and the therapist is marked as `missed`, the poster gets a `Re-Offer` button to reset their status to pending and restart the clock, giving them a second chance without having to start a new referral.

### 7. Case Brief & Handoff Improvements
- **The "All-Clear" Toggle & Quick-Insert Tags**: Replace standard checkboxes for Precautions. Add an "All-Clear" toggle (`No Precautions - Cleared for standard therapy`) which hides the text box. If unchecked, provide a single text box with Quick-Insert Tags above it (e.g., `[Weight-Bearing]`, `[ROM Limit]`). Tapping a tag inserts the text so the therapist can specify the exact limit.
- **Standardize the Contact Window**: Split the free-text `preferredContactWindow` field into two inputs: a dropdown for the **Method** (e.g., WhatsApp, Phone Call) and a short text input for the **Time** (e.g., "Weekdays after 6 PM").
- **Expected Goal Field**: Introduce a new field called `Primary Goal / Expected Outcome` so the receiving therapist has a clear clinical target.
- **Smart Character Limits**: Increase the strict 300-character cap on `relevantHistory` and `reasonForReferral` to **1,000 characters** to accommodate proper clinical timelines. 
- **No Attachments**: File attachments will remain strictly disabled to maintain zero-liability regarding PHI storage.

### 8. Directory Search
- **Dynamic Omni-Search Bar**: Real-time keyword searching against names, certifications, and roles using `useTransition`.
- **Horizontal Quick Filters**: Introduce a horizontal bar for core filters (`Locality`, `Role`, `Visit Type`). 
- **Remove Connect Action from Cards**: The `ProfileCard` will **not** contain the "Connect" action on the directory list view, forcing users to click into the profile.

### 9. Communities
- **"Pledge to Unlock" Model**: Change the "Create Community" flow for niche/user-created groups. Users suggest a community, and it goes to an "Upcoming" board. It only goes live once it receives X pledges (e.g., 20), preventing empty ghost-towns.
- **Auto-Generation**: Rely on the weekly job to auto-generate institution/certification communities based on database density.

### 10. Practices & Workplace Communities
- **Main Navigation Promotion**: Elevate "Practices" to be a primary tab on the top navigation bar.
- **Onboarding / Offboarding Notifications**: Implement the two-way consent flows for employees.
- **Invite UI Placement**: Remove the "Invite to Practice" button from the public Therapist Directory Profile. Move this functionality exclusively into the private *Practice Management Dashboard*.
- **Practice Profile Enhancements**: Transform the public page into a true Business Profile (Accepting Patients badge, Operating Hours, Contact Info, primary CTA).
- **Add a Practice Form (UX Improvements)**: Ask *"Are you the owner/manager?"* at the end of the form. Add optional Website/Phone fields.

### 11. Circles & Therapist Profiles
- **Routing & Management**: Move the "Circles Manager" out of the main top navigation and into the User Profile dropdown.
- **Create Circle UX**: Replace inline text input with a primary `+ Create Circle` button that opens a modern modal/sheet with an embedded directory search bar.
- **Therapist Profile Hierarchy**: On a therapist's full public profile, the primary CTA must be **"Refer Patient"**. The **"Save to Circle"** action should be visually downgraded.
- **The Intimacy Rule (15-Member Cap)**: Enforce a strict limit of exactly **15 members** per Circle.
- **Circle Visuals & Icons**: Add "Avatar Piles" to the list view and allow custom Icons/Color Tags.

### 12. Administrative & Security Polish
- **Vacation Mode (Auto-Decline)**: Add an `Out of Office until [Date]` toggle to Settings. When active, it automatically declines any incoming referral offers instantly to preserve response-time metrics.
- **Granular Notification Matrix**: Update notification settings to allow distinct channel choices (Email vs. Push) for different event types (e.g., Push for Urgent Referrals, Email for Routine).
- **Security Audit Log**: Add a "Recent Login Activity" widget to the user's security settings (showing device, location, and timestamp) to build platform trust.
- **Admin SLA Color-Coding**: In the Admin Dashboard, color-code all curation and verification queues based on age (e.g., >24h turns Red) to enforce service level agreements.
- **Admin Bulk Actions**: Add checkbox-driven "Bulk Approve" and "Bulk Reject" actions to curation queues (like Pincodes and Institutions) to massively speed up admin ops.
- **Support Impersonation Mode**: Build a secure, strictly-audited `Impersonate User` feature for Super Admins. This allows an admin to temporarily view the UI exactly as a specific therapist sees it to rapidly debug support tickets.
