// Drizzle schema — source of truth for generated migrations (drizzle-kit
// generate + migrate, never push). Phase 1 (Identity core): users,
// auth_identities, admin identity/roles, audit_logs. Read plan §4 (Auth),
// §8A (Verified Profiles through auth_identities), §8G5 (Admin Roles)
// before touching this file — CLAUDE.md's instruction, not a suggestion.
//
// Hand-written SQL migrations (extensions, PL/pgSQL functions, views, role
// grants/revocations) are tracked in the same drizzle journal alongside
// generated ones — see drizzle/ and BUILD_SEQUENCE.md Phase 0's migration
// conventions note.

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  inet,
  doublePrecision,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const accountTypeEnum = pgEnum("account_type", [
  "therapist",
  "practice_manager",
  "staff",
]);

// §8D — the referral matching filter's only backing fields. Scoped to the
// pilot's three professions and two specialties (plan §1/§2), not a general
// taxonomy — see §1C for how a new profession gets added later.
export const roleNeededTypeEnum = pgEnum("role_needed_type", [
  "physiotherapist",
  "occupational_therapist",
  "speech_language_pathologist",
]);

export const specializationTypeEnum = pgEnum("specialization_type", [
  "musculoskeletal_orthopaedic",
  "neuro_rehab",
]);

export const genderTypeEnum = pgEnum("gender_type", [
  "male",
  "female",
  "non_binary",
  "prefer_not_to_say",
]);

export const ageGroupTypeEnum = pgEnum("age_group_type", [
  "pediatric",
  "adult",
  "geriatric",
]);

// §8A1a — two-tier verification. `recompute_verification_stage(user_id)` is
// the ONLY writer of users.verification_stage (Phase 3, once credentials
// exists) — never write this column directly from a route or server action.
export const profileVerificationStageEnum = pgEnum("profile_verification_stage", [
  "unverified",
  "qualification_confirmed",
  "credentials_verified",
]);

// §8G5 — admin roles. Multiple roles per admin via admin_user_roles below,
// not a single column on admin_users.
export const adminRoleTypeEnum = pgEnum("admin_role_type", [
  "super_admin",
  "verification_admin",
  "grievance_officer",
  "support_admin",
  "referral_ops_admin",
  "technical_admin",
]);

// audit_logs.acting_context — §8G5's "one account, two contexts" rule.
export const actingContextEnum = pgEnum("acting_context", ["therapist", "admin"]);

// §6 — the curated home-visit/matching area tree, distinct from Google
// Places (practice addresses only, §8C). `area_level` is the tree depth;
// the pilot ships `zone` and `locality` only — `city` exists for the §6
// multi-city future without a schema change.
export const areaLevelEnum = pgEnum("area_level", ["city", "zone", "locality"]);

// §8B — course/certification curation. `master_course_id IS NOT NULL` means
// `approved`; this is application-level logic (see courseCompletions below),
// never a column default, so the enum exists for the value set, not to
// drive a default.
export const curationStatusEnum = pgEnum("curation_status", ["approved", "pending_review"]);

// §8B / §8B3 — course/certification category. `electrotherapy_modalities`
// is a category, not a credential_tier value (§8B3) — machine/equipment
// itself lives on practices.equipment_available, never here.
export const courseCategoryEnum = pgEnum("course_category", [
  "manual_therapy",
  "exercise_therapeutic",
  "electrotherapy_modalities",
  "other",
]);

// §8B's 4-tier hybrid classification for course_completions — distinct
// from credential_type (§8A1a), which classifies degree/PG/council
// documents that gate verification. These never gate verification.
export const courseTierEnum = pgEnum("course_tier", [
  "diploma",
  "international_accredited_certification",
  "other_workshop",
]);

// §8A1a — statutory registration (state councils, NCAHP) vs. professional
// association (IAP). Only the former can advance verification_stage to
// credentials_verified — see master_councils below.
export const councilTypeEnum = pgEnum("council_type", [
  "statutory_registration",
  "professional_association",
]);

// §8A1a — the three document types credentials OCR-gates. Distinct from
// courseTierEnum above, which classifies diplomas/certifications that
// never gate verification.
export const credentialTypeEnum = pgEnum("credential_type", [
  "degree",
  "postgraduate_degree",
  "council_registration",
]);

// §8A — Approve / Raise query / Reject, plus the states that flow keeps
// query_raised items out of the main queue (query_raised) and terminal
// states (approved/rejected). Never advances itself — an admin action or
// the credential-expiry job always drives the transition.
export const credentialStatusEnum = pgEnum("credential_status", [
  "pending",
  "under_review",
  "query_raised",
  "approved",
  "rejected",
]);

// §8C1 — practice claims. Same small, fixed-vocabulary shape as
// credential_status above (CLAUDE.md's ENUM exception), reused for the
// same reason: this is a workflow status with a bounded state set, not an
// open-ended category that grows over time.
export const practiceClaimStatusEnum = pgEnum("practice_claim_status", [
  "submitted",
  "under_review",
  "query_raised",
  "approved",
  "rejected",
  "withdrawn",
]);

// §8C2 — practice_users. Three fixed, small vocabularies.
export const practiceAccessRoleEnum = pgEnum("practice_access_role", [
  "owner",
  "manager",
  "staff",
]);
export const practiceRelationshipTypeEnum = pgEnum("practice_relationship_type", [
  "owns",
  "works_at",
  "visits",
]);
export const affiliationConsentStatusEnum = pgEnum("affiliation_consent_status", [
  "pending",
  "accepted",
  "declined",
]);
export const affiliationAssertedByEnum = pgEnum("affiliation_asserted_by", ["self", "practice"]);

// §8D — "Urgent" means the patient needs to start soon, not a medical
// emergency (shown live beside the field at post time).
export const referralUrgencyEnum = pgEnum("referral_urgency", ["routine", "urgent"]);

// §8D — the pilot ships 'relay' only. 'direct' is fully specified and its
// columns exist (contact_ack_deadline_at etc.) but no UI offers it and no
// row is ever created with it during the pilot.
export const contactModeEnum = pgEnum("contact_mode", ["direct", "relay"]);

export const notificationOutboxStatusEnum = pgEnum("notification_outbox_status", [
  "pending",
  "sent",
  "failed",
]);

// §10B — onboarding moments, each shown at most once per user (enforced by
// a unique index on user_id+moment below, not by application discipline).
export const onboardingMomentEnum = pgEnum("onboarding_moment", [
  "profile_preview_shown",
  "locality_context_shown",
  "verification_celebration_shown",
  "share_card_generated",
]);

// §8E3 — a small, genuinely fixed vocabulary (CLAUDE.md's ENUM exception),
// unlike home_case_referrals.status/referral_interest.status which are
// TEXT+CHECK because they're expected to grow.
export const communityTypeEnum = pgEnum("community_type", ["platform_official", "user_created"]);
export const communityStatusEnum = pgEnum("community_status", ["active", "pending_review", "closed"]);
export const communityPostTypeEnum = pgEnum("community_post_type", ["announcement", "resource", "event"]);
export const communityPostStatusEnum = pgEnum("community_post_status", [
  "pending_review",
  "published",
  "removed",
]);

// §8G3 — a small, genuinely fixed vocabulary (CLAUDE.md's ENUM exception).
export const feedbackCategoryEnum = pgEnum("feedback_category", [
  "bug",
  "feature_request",
  "verification_issue",
  "content_issue",
  "grievance",
  "other",
]);
export const feedbackStatusEnum = pgEnum("feedback_status", [
  "new",
  "triaged",
  "planned",
  "shipped",
  "wont_do",
]);

// ---------------------------------------------------------------------------
// users — §8A. users.id equals auth.users.id (Supabase Auth); the row is
// created by a server action on first sign-in, never a database trigger —
// see src/app/actions/auth.ts.
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),

    slug: text("slug"),
    profileVisibility: text("profile_visibility", {
      enum: ["public", "unlisted", "hidden"],
    })
      .notNull()
      .default("hidden"),
    profileStatus: text("profile_status", {
      enum: ["draft", "active", "suspended"],
    })
      .notNull()
      .default("draft"),

    accountType: accountTypeEnum("account_type").notNull().default("therapist"),

    // Verification matching only — never displayed. Collected at credential
    // upload (Phase 3), not at signup.
    legalName: text("legal_name"),
    // The only name shown anywhere public.
    displayName: text("display_name"),
    // Public via CDN (ahp-network-photos bucket, provisioned in Phase 0 —
    // §7's storage split), unlike credential documents. Missing from the
    // original Phase 1 build despite the bucket already existing; added
    // here because Phase 5's profile card and OG image both need it.
    photoUrl: text("photo_url"),

    role: roleNeededTypeEnum("role"),
    specializations: specializationTypeEnum("specializations")
      .array()
      .notNull()
      .default(sql`'{}'::specialization_type[]`),

    gender: genderTypeEnum("gender"),
    ageGroupsServed: ageGroupTypeEnum("age_groups_served")
      .array()
      .notNull()
      .default(sql`'{}'::age_group_type[]`),

    bio: text("bio"),
    yearsExperience: integer("years_experience"),
    teleRehabAvailable: boolean("tele_rehab_available").notNull().default(false),
    languages: text("languages").array(),

    acceptsClinicVisits: boolean("accepts_clinic_visits").notNull().default(true),
    acceptsHomeVisits: boolean("accepts_home_visits").notNull().default(true),
    // §8A — separates "I have this skill" from "I want referrals for it
    // right now." Directly reduces irrelevant notifications.
    acceptingReferrals: boolean("accepting_referrals").notNull().default(true),

    availabilityNotes: text("availability_notes"),
    availableForNewPatients: boolean("available_for_new_patients")
      .notNull()
      .default(false),
    availabilityUpdatedAt: timestamp("availability_updated_at", { withTimezone: true }),

    verificationStage: profileVerificationStageEnum("verification_stage")
      .notNull()
      .default("unverified"),

    // §5's versioned envelope (v, kid, alg, iv, ct, tag) — see src/lib/crypto.ts.
    // The pilot's ONE encrypted field. Never used as a lookup key, never
    // queried by equality — that's what makes envelope encryption safe here.
    publicContactValue: jsonb("public_contact_value"),
    contactPreference: text("contact_preference", {
      enum: ["phone", "whatsapp", "form_only", "none"],
    })
      .notNull()
      .default("none"),

    openToOpportunities: boolean("open_to_opportunities").notNull().default(false),
    referralCode: text("referral_code"),
    invitedByUserId: uuid("invited_by_user_id"),

    // §10A — true for every account created before the §14 go/no-go review.
    isFoundingMember: boolean("is_founding_member").notNull().default(false),

    // §4's sensitive-identity-change protocol: set 48 hours out whenever
    // email/phone/legal_name changes or an auth identity is linked/unlinked.
    // Checked by the (not-yet-built) referral claim/contact-disclosure
    // paths in Phase 6 — the account keeps working for everything else
    // during the hold.
    contactDisclosureHoldUntil: timestamp("contact_disclosure_hold_until", {
      withTimezone: true,
    }),

    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Public eligibility must never be inferred from account_type alone —
    // directory queries filter on all three: account_type = 'therapist' AND
    // profile_status = 'active' AND profile_visibility = 'public' (§8A).
    uniqueIndex("users_active_slug")
      .on(table.slug)
      .where(sql`${table.profileStatus} = 'active' AND ${table.deletedAt} IS NULL`),
    index("users_directory")
      .on(table.accountType, table.verificationStage)
      .where(sql`${table.deletedAt} IS NULL AND ${table.accountType} = 'therapist'`),
    index("users_specializations").using("gin", table.specializations),
  ],
);

// ---------------------------------------------------------------------------
// auth_identities — populated from Supabase Auth's own identity records on
// sign-in/link. Remains the AHP-specific mapping regardless of which auth
// provider issues the session (§8A).
// ---------------------------------------------------------------------------

export const authIdentities = pgTable(
  "auth_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider", { enum: ["google", "email"] }).notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    emailAtLink: text("email_at_link"),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("auth_identities_provider_account").on(
      table.provider,
      table.providerAccountId,
    ),
    index("auth_identities_by_user").on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// admin_users / admin_user_roles — §8G5. Roles live in the junction table
// (multiple roles per admin, independently revocable), not a column here.
// ---------------------------------------------------------------------------

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One account, two contexts (§8G5) — a user gets at most one admin_users
    // row, ever. Without this, ON CONFLICT DO NOTHING in
    // scripts/bootstrap-admin.mjs silently never conflicts, and re-running
    // it creates a fresh duplicate admin identity for the same person every
    // time — found by actually re-running the script, not by inspection.
    uniqueIndex("admin_users_user_id_unique").on(table.userId),
  ],
);

export const adminUserRoles = pgTable(
  "admin_user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id),
    role: adminRoleTypeEnum("role").notNull(),
    assignedByAdminId: uuid("assigned_by_admin_id").references(() => adminUsers.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByAdminId: uuid("revoked_by_admin_id").references(() => adminUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("admin_user_roles_active_unique")
      .on(table.adminUserId, table.role)
      .where(sql`${table.revokedAt} IS NULL`),
    index("admin_user_roles_by_role").on(table.role).where(sql`${table.revokedAt} IS NULL`),
  ],
);

// ---------------------------------------------------------------------------
// audit_logs — APPEND-ONLY. UPDATE/DELETE revoked from ahp_app at the
// database level in drizzle/0003_audit_logs_append_only.sql, not by
// convention. before_state/after_state must be PII-redacted by the caller
// before insert (§5) — this schema doesn't and can't enforce that itself.
// ---------------------------------------------------------------------------

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  actorType: text("actor_type", { enum: ["user", "admin", "system"] }).notNull(),
  actingContext: actingContextEnum("acting_context"),
  action: text("action").notNull(),
  targetTable: text("target_table"),
  targetId: uuid("target_id"),
  outcome: text("outcome", { enum: ["success", "failure"] }).notNull(),
  correlationId: uuid("correlation_id"),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  ipAddress: inet("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// areas — §6's curated home-visit/matching tree. NOT Google Places (that's
// practices.google_place_id, §8C) — mismatched IDs here would produce a
// silently empty matching pool, indistinguishable from a genuine density
// problem, so this stays a small hand-curated set forever, never
// autocomplete-backed.
//
// [H4] Row curation is founder content work, not code: the pilot zone
// (Kondapur/Gachibowli/Madhapur) and its immediate neighbours are seeded
// first — enough for matching and a realistic home-visit-area choice — and
// full-city curation continues alongside later phases without blocking
// them. This table and its ancestor_ids tree are built in full regardless;
// only the row count grows over time.
// ---------------------------------------------------------------------------

export const areas = pgTable(
  "areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    areaLevel: areaLevelEnum("area_level").notNull(),
    parentId: uuid("parent_id"),
    // [v19] Maintained on insert (never recomputed by a trigger — a fixed,
    // hand-curated 100-150 row tree changes rarely enough that a helper
    // script recomputing this on each admin-authored insert is simpler and
    // more auditable than a trigger). Matching (§8D) and the empty-pool
    // parent-zone fallback both do array-containment checks against this
    // column instead of a recursive CTE, which is what makes matching a
    // single indexed query rather than a recursive traversal on every post.
    ancestorIds: uuid("ancestor_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("areas_slug_unique").on(table.slug),
    index("areas_by_parent").on(table.parentId),
    index("areas_ancestor_ids").using("gin", table.ancestorIds),
  ],
);

// ---------------------------------------------------------------------------
// master_courses_certifications / course_completions — §8B's 4-tier hybrid
// course/certification taxonomy. Diploma, International Accredited
// Certification, Other Workshop — curated display taxonomy, never OCR'd,
// never gates verification_stage. (Graduation/PG/Council Registration are a
// different taxonomy entirely — credentials, built in Phase 3, OCR-gated.)
// ---------------------------------------------------------------------------

export const masterCoursesCertifications = pgTable(
  "master_courses_certifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    category: courseCategoryEnum("category").notNull(),
    tier: courseTierEnum("tier").notNull(),
    nomenclature: text("nomenclature").notNull(),
    // §8E3 certification communities: a short admin-curated allow-list
    // (Mulligan, Maitland, McKenzie/MDT, Cyriax, PNF, Bobath/NDT, Barral)
    // rather than every row here — avoids a long tail of near-empty
    // communities for one-off local workshop certificates. Built here in
    // Phase 2, consumed by Phase 9's community auto-generation.
    eligibleForCommunityAutoGeneration: boolean(
      "eligible_for_community_auto_generation",
    )
      .notNull()
      .default(false),
    // Admin-uploaded only, generated placeholder otherwise — never scraped
    // (CLAUDE.md conventions, §8E3).
    logoUrl: text("logo_url"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("master_courses_certifications_search").using(
      "gin",
      sql`${table.normalizedName} gin_trgm_ops`,
    ),
  ],
);

export const courseCompletions = pgTable(
  "course_completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    masterCourseId: uuid("master_course_id").references(
      () => masterCoursesCertifications.id,
    ),
    // Free-text fallback when masterCourseId is null — this row then enters
    // the curation queue (curationStatus below) instead of gating anything.
    customCourseName: text("custom_course_name"),
    providerName: text("provider_name"),
    durationDays: integer("duration_days").notNull().default(2),
    creditHours: text("credit_hours"), // NUMERIC(5,2), nullable, unused in v1
    hasPassedExam: boolean("has_passed_exam").notNull().default(false),
    // System-computed from the linked master row, never user-editable.
    calculatedTier: courseTierEnum("calculated_tier"),
    calculatedNomenclature: text("calculated_nomenclature"),
    certificateUrl: text("certificate_url"),
    completionYear: integer("completion_year"),
    // Application-level logic, not a column default: masterCourseId set →
    // 'approved'; null → 'pending_review' (enters the admin curation queue,
    // same mechanism as master_institutions below).
    curationStatus: curationStatusEnum("curation_status")
      .notNull()
      .default("pending_review"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("course_completions_by_user")
      .on(table.userId)
      .where(sql`${table.deletedAt} IS NULL`),
    index("course_completions_curation_queue")
      .on(table.curationStatus)
      .where(sql`${table.curationStatus} = 'pending_review' AND ${table.deletedAt} IS NULL`),
  ],
);

// ---------------------------------------------------------------------------
// master_institutions — §8B2. Built organically from real submissions
// (same reasoning that rejected pre-seeding therapist profiles and a
// hand-built country-wide college directory), never auto-created from an
// unreviewed fuzzy match. `credentials.institution_id` is added in Phase 3
// once the credentials table exists — this phase ships the table and its
// curation queue only.
// ---------------------------------------------------------------------------

export const masterInstitutions = pgTable(
  "master_institutions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    city: text("city"),
    normalizedName: text("normalized_name").notNull(),
    // "Same curation pattern as course taxonomy" (§8B2's own heading) — a
    // fuzzy-match miss on credential submission (Phase 3) inserts a
    // pending_review row here for an admin to link-or-add, never an
    // auto-approved one. Defaults to approved because every row inserted
    // directly by this phase's seed/admin-add path is already reviewed by
    // construction; only the Phase 3 no-match path inserts pending_review.
    curationStatus: curationStatusEnum("curation_status").notNull().default("approved"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("master_institutions_search").using(
      "gin",
      sql`${table.normalizedName} gin_trgm_ops`,
    ),
    index("master_institutions_curation_queue")
      .on(table.curationStatus)
      .where(sql`${table.curationStatus} = 'pending_review'`),
  ],
);

// ---------------------------------------------------------------------------
// master_councils — §8A1a. Small, hand-curated, deliberately NOT grown the
// same way as master_institutions: registering bodies are few, high-stakes,
// and a real target for fake "councils" in this space. Never auto-create a
// row here from OCR text regardless of match confidence — this table only ever
// grows via the same pending_review admin curation queue as institutions,
// on demand, when a therapist from outside Telangana actually signs up.
// `credentials.council_id` is added in Phase 3 once credentials exists.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// credentials — §8A/§8A1a/§8A2. OCR-gated (Google Cloud Vision,
// DOCUMENT_TEXT_DETECTION), never auto-approved at any confidence — status
// and the user's verification_stage are both written only by a human admin
// action (via recompute_verification_stage(user_id), drizzle/0009). This
// table is the sole source of truth for verification gating;
// course_completions is the sole source of truth for profile display,
// synced one-way from an approved degree/PG row here.
// ---------------------------------------------------------------------------

export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: credentialTypeEnum("type").notNull(),
    registrationNumber: text("registration_number"),
    institutionId: uuid("institution_id").references(() => masterInstitutions.id),
    // Required when type = 'council_registration', NULL otherwise — enforced
    // at the application layer (submission action), not a CHECK constraint,
    // since credential_type-conditional NOT NULL needs either a CHECK
    // expression per type or a trigger; the submission path is the single
    // writer of new rows, so this is enforced once, there.
    councilId: uuid("council_id").references(() => masterCouncils.id),
    // Private R2 object key (ahp-network-credentials bucket), signed access
    // only — never the object's public URL, there isn't one.
    documentUrl: text("document_url"),
    ocrExtractedJson: jsonb("ocr_extracted_json"),
    // §8A2 — feeds admin queue PRIORITY ONLY. Never read by any gating
    // logic; recompute_verification_stage() doesn't reference this column.
    confidenceScore: integer("confidence_score"),
    status: credentialStatusEnum("status").notNull().default("pending"),
    queryMessage: text("query_message"),
    queryRaisedAt: timestamp("query_raised_at", { withTimezone: true }),
    queryRaisedByAdminId: uuid("query_raised_by_admin_id").references(() => adminUsers.id),
    queryRespondedAt: timestamp("query_responded_at", { withTimezone: true }),
    expiryDate: timestamp("expiry_date", { withTimezone: true }),
    verifiedBy: uuid("verified_by").references(() => adminUsers.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The admin queue's main list: pending/under_review, oldest and
    // highest-confidence first, never query_raised (that's a separate
    // "Awaiting therapist" list, so it doesn't inflate the SLA number).
    index("credentials_queue")
      .on(table.status, table.confidenceScore)
      .where(sql`${table.status} IN ('pending', 'under_review') AND ${table.deletedAt} IS NULL`),
    index("credentials_awaiting_therapist")
      .on(table.queryRaisedAt)
      .where(sql`${table.status} = 'query_raised'`),
    index("credentials_by_user")
      .on(table.userId)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const masterCouncils = pgTable(
  "master_councils",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    councilType: councilTypeEnum("council_type").notNull(),
    state: text("state"), // NULL for national bodies (NCAHP, IAP)
    applicableRole: roleNeededTypeEnum("applicable_role"), // nullable — some councils are role-specific
    // Regex, per-council format — feeds the OCR scoring check in §8A2 (Phase 3).
    registrationNumberPattern: text("registration_number_pattern"),
    // §8A1a: "future states are curated on demand... enters the same
    // pending_review curation queue already built for institutions."
    // Pilot's 3-row hand-seed is approved by construction; a state council
    // proposed later (a therapist from outside Telangana) lands here as
    // pending_review and is never auto-created regardless of confidence.
    curationStatus: curationStatusEnum("curation_status").notNull().default("approved"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("master_councils_curation_queue")
      .on(table.curationStatus)
      .where(sql`${table.curationStatus} = 'pending_review'`),
  ],
);

// ---------------------------------------------------------------------------
// practices — §8C. Any verified therapist can create a record; the owner
// later claims it with documentation (§8C1) the same way credentials are
// reviewed — never proven by a Google Business Profile link, never
// auto-merged on a dedupe match.
//
// No separate `verification_status` column, unlike the plan's raw sketch:
// the only thing "Ownership Verified" (§1A, §8C3) ever means is
// claim_status = 'claimed', and a second column carrying the same fact
// would need to stay in sync with the first by convention rather than by
// construction — exactly the duplicate-vocabulary risk CLAUDE.md calls
// out for therapist_skills.verification_status. One column, one writer.
// ---------------------------------------------------------------------------

export const practices = pgTable(
  "practices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // Growing category, not a small fixed set — CLAUDE.md's TEXT+CHECK
    // convention, enforced by the CHECK constraint added in the migration.
    type: text("type").notNull(),
    slug: text("slug"),

    // §6 — Places is for practice ADDRESSES only, never the curated
    // `areas` matching tree. google_place_id is the primary dedup key.
    googlePlaceId: text("google_place_id"),
    formattedAddress: text("formatted_address"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    // Secondary dedupe path for when Places has no listing, or multiple
    // pins exist for the same real place (§8C).
    normalizedName: text("normalized_name"),
    normalizedAddress: text("normalized_address"),

    registrationNumber: text("registration_number"),

    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),

    claimStatus: text("claim_status").notNull().default("unclaimed"),
    claimedByUserId: uuid("claimed_by_user_id").references(() => users.id),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    // Points at the practice this one is a suspected duplicate of — surfaced
    // as a merge candidate in the admin queue, NEVER auto-merged (§8C).
    possibleDuplicateOf: uuid("possible_duplicate_of"),

    // true until claimed (§8C: "noindex until claimed. No schema.org
    // markup on unclaimed practices") — an unclaimed listing is a
    // therapist's unverified assertion, not a fact search engines should
    // amplify.
    noindex: boolean("noindex").notNull().default(true),

    logoUrl: text("logo_url"),
    coverImageUrl: text("cover_image_url"),
    bio: text("bio"),
    servicesOffered: text("services_offered").array(),
    specialties: text("specialties").array(),
    equipmentAvailable: jsonb("equipment_available"),
    websiteUrl: text("website_url"),
    phone: text("phone"),
    email: text("email"),
    ogImageUrl: text("og_image_url"),
    qrCodeUrl: text("qr_code_url"),

    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("practices_unique_place")
      .on(table.googlePlaceId)
      .where(sql`${table.googlePlaceId} IS NOT NULL AND ${table.deletedAt} IS NULL`),
    index("practices_dedupe_candidates")
      .on(table.normalizedName, table.normalizedAddress)
      .where(sql`${table.deletedAt} IS NULL`),
    check(
      "practices_claim_status_check",
      sql`${table.claimStatus} IN ('unclaimed', 'claim_pending', 'claimed', 'disputed')`,
    ),
    check(
      "practices_type_check",
      sql`${table.type} IN ('clinic', 'hospital_department', 'home_care_agency', 'wellness_center', 'other')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// practice_claims — §8C1. Proved the same way credentials are: document
// upload + admin review, reusing the §8A2 queue mechanism. Contested
// claims (two open claims on one practice) freeze the record and escalate
// — never resolved first-come.
// ---------------------------------------------------------------------------

export const practiceClaims = pgTable(
  "practice_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    claimantUserId: uuid("claimant_user_id")
      .notNull()
      .references(() => users.id),
    // Plan §8C1 types this as plain TEXT, not an enum — two fixed values
    // today, kept as TEXT+CHECK per CLAUDE.md's growing-field convention
    // since a practice's claimed relationship is closer in shape to a
    // category than a workflow state.
    claimedRelationship: text("claimed_relationship").notNull(),
    // Private R2 object: registration certificate, GST, trade licence.
    documentUrl: text("document_url").notNull(),
    registrationNumber: text("registration_number"),
    status: practiceClaimStatusEnum("status").notNull().default("submitted"),
    queryMessage: text("query_message"),
    reviewedByAdminId: uuid("reviewed_by_admin_id").references(() => adminUsers.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One open claim per (practice, claimant) — a second, different
    // claimant's open claim on the SAME practice is exactly the contested
    // case the application logic checks for on insert (§8C1), not
    // something this index itself needs to block.
    uniqueIndex("practice_claims_one_open_per_claimant")
      .on(table.practiceId, table.claimantUserId)
      .where(sql`${table.status} IN ('submitted', 'under_review', 'query_raised')`),
    index("practice_claims_queue").on(table.status, table.createdAt),
    check(
      "practice_claims_relationship_check",
      sql`${table.claimedRelationship} IN ('owner', 'manager')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// practice_users — §8C2. Affiliations. Two directions, two consent
// models: a practice adding a therapist starts 'pending' and is only
// publicly visible on acceptance; a therapist asserting their own
// workplace is immediately visible. An owner can never delete a
// therapist-asserted affiliation, only dispute it (routes to admin).
// ---------------------------------------------------------------------------

export const practiceUsers = pgTable(
  "practice_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    accessRole: practiceAccessRoleEnum("access_role").notNull(),
    relationshipType: practiceRelationshipTypeEnum("relationship_type").notNull(),
    consentStatus: affiliationConsentStatusEnum("consent_status").notNull().default("pending"),
    assertedBy: affiliationAssertedByEnum("asserted_by").notNull(),
    disputedAt: timestamp("disputed_at", { withTimezone: true }),
    disputedByUserId: uuid("disputed_by_user_id").references(() => users.id),
    isPublic: boolean("is_public").notNull().default(false),
    displayTitle: text("display_title"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedByUserId: uuid("ended_by_user_id").references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("practice_users_by_practice")
      .on(table.practiceId)
      .where(sql`${table.deletedAt} IS NULL AND ${table.endedAt} IS NULL`),
    index("practice_users_by_user")
      .on(table.userId)
      .where(sql`${table.deletedAt} IS NULL AND ${table.endedAt} IS NULL`),
    // §8C2's public-affiliation view: accepted, not ended, not disputed,
    // consent given. The profile-page query filters on all of these, so
    // an index matching the actual predicate avoids a sequential scan on
    // what's a per-page-render query (CLAUDE.md's "no N+1, indexes match
    // actual query predicates" P0 requirement, applied here early).
    index("practice_users_public_accepted")
      .on(table.practiceId, table.isPublic)
      .where(
        sql`${table.consentStatus} = 'accepted' AND ${table.isPublic} = true AND ${table.endedAt} IS NULL AND ${table.deletedAt} IS NULL`,
      ),
  ],
);

// ---------------------------------------------------------------------------
// profile_contact_reveals — §9. A public-directory reveal, distinct from
// the dormant direct-mode contact_reveals (§8D) which relay writes no row
// to. Different actor (an anonymous visitor), different data, different
// retention (purge ip_hash/user_agent at 90 days, §8H). Rate limiting
// runs against this table at pilot volume — no KV, that stays P1 (§7).
// ---------------------------------------------------------------------------

export const profileContactReveals = pgTable(
  "profile_contact_reveals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileUserId: uuid("profile_user_id")
      .notNull()
      .references(() => users.id),
    ipHash: text("ip_hash").notNull(), // hashed, never stored raw — drives the per-IP rate limit
    userAgent: text("user_agent"),
    revealedAt: timestamp("revealed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("profile_contact_reveals_rate").on(table.ipHash, table.revealedAt.desc()),
    index("profile_contact_reveals_by_profile").on(table.profileUserId, table.revealedAt.desc()),
  ],
);

// ---------------------------------------------------------------------------
// home_visit_areas — plan §8A. A real, necessary dependency this phase
// exposed: the directory's "Locality" default filter (§9) and the
// referral matching pool (§8D) both need a therapist-to-area link, and no
// prior phase built it. Areas selector (src/components/areas/area-
// selector.tsx, Phase 2) is the intended UI, wired up here for the first
// time (max: undefined → multi-select, a therapist's home-visit coverage).
// ---------------------------------------------------------------------------

export const homeVisitAreas = pgTable(
  "home_visit_areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    areaId: uuid("area_id")
      .notNull()
      .references(() => areas.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("home_visit_areas_unique")
      .on(table.userId, table.areaId)
      .where(sql`${table.deletedAt} IS NULL`),
    index("home_visit_areas_by_area")
      .on(table.areaId)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

// ---------------------------------------------------------------------------
// Phase 6 — Referral board core. §8D in full, §8D2 (patient consent).
//
// The three state transitions (shortlist_referral, accept_referral,
// lapse_offers) are hand-written PL/pgSQL functions in
// drizzle/0016_phase6_referral_board.sql, each invoked by the app as ONE
// `SELECT fn(...)` statement — CLAUDE.md's non-negotiable. Never
// reimplement any of them as client-side queries or a wrapped
// db.transaction(); that is exactly the thing single-statement PL/pgSQL
// removes the need for over Hyperdrive's transaction-mode pooling.
// ---------------------------------------------------------------------------

export const homeCaseReferrals = pgTable(
  "home_case_referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // TEXT + CHECK, not a Postgres ENUM — CLAUDE.md's convention for a
    // status field expected to grow (a CHECK migrates inside a
    // transaction; an ENUM alteration cannot).
    status: text("status").notNull().default("open"),
    urgency: referralUrgencyEnum("urgency").notNull().default("routine"),
    // Visible to admins only, never the matched pool — required when
    // urgency = 'urgent', enforced at the application layer (the
    // submission action), same reasoning as credentials.council_id's
    // conditional-NOT-NULL note elsewhere in this file.
    urgencyReason: text("urgency_reason"),
    contactMode: contactModeEnum("contact_mode").notNull().default("relay"),
    postedByUserId: uuid("posted_by_user_id")
      .notNull()
      .references(() => users.id),
    postedByPracticeId: uuid("posted_by_practice_id").references(() => practices.id),
    postedByType: text("posted_by_type").notNull(),
    roleNeeded: roleNeededTypeEnum("role_needed").notNull(),
    specializationNeeded: specializationTypeEnum("specialization_needed").notNull(),
    additionalContext: text("additional_context"),
    // NOT NULL, no default — §E5/CLAUDE.md: a referral posted without
    // touching this field must not silently become a clinic referral. The
    // posting form makes this a required, un-preselected choice.
    homeVisitRequired: boolean("home_visit_required").notNull(),
    locationAddress: text("location_address"),
    areaId: uuid("area_id").references(() => areas.id),
    // Free text, mandatory placeholder + inline warning against including
    // name/phone/address — enforced in the posting form, not here (§8D2).
    patientSummary: text("patient_summary"),
    patientConsentRecordedAt: timestamp("patient_consent_recorded_at", { withTimezone: true }),
    consentTextVersion: text("consent_text_version"),
    shortlistClosesAt: timestamp("shortlist_closes_at", { withTimezone: true }),
    offerExpiresAt: timestamp("offer_expires_at", { withTimezone: true }),
    // DIRECT MODE ONLY — NULL for the entire pilot, contact_mode is always
    // 'relay' in every row the app creates.
    contactAckDeadlineAt: timestamp("contact_ack_deadline_at", { withTimezone: true }),
    confirmDeadlineAt: timestamp("confirm_deadline_at", { withTimezone: true }),
    expiryStage: text("expiry_stage").notNull().default("none"),
    rerouteCount: integer("reroute_count").notNull().default(0),
    matchedPoolSizeAtPost: integer("matched_pool_size_at_post"),
    matchingAlgorithmVersion: text("matching_algorithm_version").notNull().default("v1"),
    extendedOnce: boolean("extended_once").notNull().default(false),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "home_case_referrals_status_check",
      sql`${table.status} IN ('open','shortlisted','accepted','contact_acknowledged','completed','cancelled_by_poster','expired')`,
    ),
    check(
      "home_case_referrals_expiry_stage_check",
      sql`${table.expiryStage} IN ('none','pool_expanded','admin_alerted','close_prompted')`,
    ),
    check("home_case_referrals_posted_by_type_check", sql`${table.postedByType} IN ('therapist','practice')`),
    index("home_case_referrals_open_by_area")
      .on(table.areaId, table.status)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const referralInterest = pgTable(
  "referral_interest",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referralId: uuid("referral_id")
      .notNull()
      .references(() => homeCaseReferrals.id),
    therapistUserId: uuid("therapist_user_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("pending"),
    shortlistedAt: timestamp("shortlisted_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // [G2] 'declined' — an explicit "can't take this one" tap — is a
    // different fact from 'missed' (the window closing unanswered).
    check(
      "referral_interest_status_check",
      sql`${table.status} IN ('pending','shortlisted','accepted','not_selected','withdrawn','missed','declined')`,
    ),
    uniqueIndex("referral_one_accepted")
      .on(table.referralId)
      .where(sql`${table.status} = 'accepted' AND ${table.deletedAt} IS NULL`),
    uniqueIndex("referral_one_active_interest_per_therapist")
      .on(table.referralId, table.therapistUserId)
      .where(sql`${table.status} IN ('pending','shortlisted','accepted') AND ${table.deletedAt} IS NULL`),
  ],
);

// §8D — the single write path for every notification. Never written to
// inline inside a referral transaction (CLAUDE.md non-negotiable); the
// three PL/pgSQL functions INSERT here, a separate worker claims rows with
// SELECT ... FOR UPDATE SKIP LOCKED and sends.
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    channel: text("channel").notNull(),
    template: text("template").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: notificationOutboxStatusEnum("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    // Set by the enqueuing transaction (e.g. "shortlist:{referral_id}:{user_id}")
    // so a retried transaction can't enqueue the same notification twice.
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("notification_outbox_channel_check", sql`${table.channel} IN ('push','email')`),
    uniqueIndex("notification_outbox_dedupe").on(table.dedupeKey).where(sql`${table.dedupeKey} IS NOT NULL`),
    index("notification_outbox_claimable")
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const referralEvents = pgTable(
  "referral_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referralId: uuid("referral_id")
      .notNull()
      .references(() => homeCaseReferrals.id),
    eventType: text("event_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("referral_events_by_referral").on(table.referralId, table.createdAt)],
);

// ---------------------------------------------------------------------------
// Phase 7 — push notifications. §8G4. One row per browser subscription
// (a therapist using two devices has two rows). `lastSeenAt` is updated on
// every successful push; a 404/410 from the push service means the
// subscription has gone stale (browser data cleared, permission revoked,
// uninstalled) and the row is deleted rather than retried forever — see
// src/lib/web-push.ts and the notification worker's real sender.
// ---------------------------------------------------------------------------

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint),
    index("push_subscriptions_by_user").on(table.userId),
  ],
);

// §8D (A5) — the accept_referral() function checks this table INSIDE its
// own transaction, not in front of it; a check in front of the atomic unit
// it's meant to guard would not actually guard the race (a double-tap on a
// flaky connection can arrive genuinely concurrently).
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  endpoint: text("endpoint").notNull(),
  requestHash: text("request_hash").notNull(),
  responseJson: jsonb("response_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Phase 8 — onboarding and engagement. §10B, §8A4, §8E3 (narrow slice only
// — see BUILD_SEQUENCE.md Phase 8: communities/community_posts/likes/views
// for the single founding-cohort community, never community_members,
// community_moderators, or auto-generation, all of which are Phase 9.
// ---------------------------------------------------------------------------

export const userOnboardingMoments = pgTable(
  "user_onboarding_moments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    moment: onboardingMomentEnum("moment").notNull(),
    shownAt: timestamp("shown_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => [uniqueIndex("user_onboarding_moments_once").on(table.userId, table.moment)],
);

// §8A4 — one row per invite/share action (never per invitee — no address
// book access, no invitee contact details stored). `code` is fresh per
// row; the 20/week rate limit is a count of this inviter's rows in the
// last 7 days, and accepted_by_user_id/accepted_at are set at most once,
// on the first signup that redeems the code.
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inviterUserId: uuid("inviter_user_id")
      .notNull()
      .references(() => users.id),
    inviterPracticeId: uuid("inviter_practice_id"),
    code: text("code").notNull(),
    channel: text("channel"),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("invites_by_inviter").on(table.inviterUserId, table.createdAt),
    uniqueIndex("invites_by_code").on(table.code),
  ],
);

export const communities = pgTable(
  "communities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    areaId: uuid("area_id").references(() => areas.id),
    specialization: specializationTypeEnum("specialization"),
    type: communityTypeEnum("type").notNull().default("platform_official"),
    status: communityStatusEnum("status").notNull().default("active"),
    origin: text("origin").notNull().default("platform_curated"),
    sourceInstitutionId: uuid("source_institution_id").references(() => masterInstitutions.id),
    sourceCourseId: uuid("source_course_id").references(() => masterCoursesCertifications.id),
    sourcePracticeId: uuid("source_practice_id"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    reviewedByAdminId: uuid("reviewed_by_admin_id").references(() => adminUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "communities_origin_check",
      sql`${table.origin} IN ('platform_curated','auto_generated_institution','auto_generated_certification','auto_generated_practice','user_created')`,
    ),
  ],
);

// Owned communities (platform-curated, workplace) default to 'published' —
// application logic forces 'pending_review' for unowned (institution/
// certification) origins unless the poster holds an approved moderator or
// admin grant (§8E3). The founding-cohort community is platform-curated
// and founder-only-posts at pilot, so that branch is exercised here.
export const communityPosts = pgTable(
  "community_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => communities.id),
    postedByUserId: uuid("posted_by_user_id")
      .notNull()
      .references(() => users.id),
    type: communityPostTypeEnum("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    url: text("url"),
    status: communityPostStatusEnum("status").notNull().default("published"),
    reviewedByAdminId: uuid("reviewed_by_admin_id").references(() => adminUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("community_posts_feed")
      .on(table.communityId, table.createdAt)
      .where(sql`${table.status} = 'published'`),
  ],
);

export const communityPostLikes = pgTable(
  "community_post_likes",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => communityPosts.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("community_post_likes_pk").on(table.postId, table.userId)],
);

export const communityPostViews = pgTable(
  "community_post_views",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => communityPosts.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("community_post_views_pk").on(table.postId, table.userId)],
);

// ---------------------------------------------------------------------------
// Phase 11 — feedback, incl. the grievance channel (§8G3, §8G5). user_id is
// nullable: a deletion request per §8H nulls it while keeping category and
// status for the aggregate backlog. acknowledged_at/resolved_at exist for
// every row but are only ever set on grievance items in practice — §8G5's
// "own category with acknowledged_at/resolved_at columns" is a column
// addition to this one table, not a second one.
// ---------------------------------------------------------------------------

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id),
    category: feedbackCategoryEnum("category").notNull(),
    message: text("message").notNull(),
    context: jsonb("context").notNull().default({}),
    contactOk: boolean("contact_ok").notNull().default(false),
    status: feedbackStatusEnum("status").notNull().default("new"),
    adminNotes: text("admin_notes"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("feedback_message_length_check", sql`char_length(${table.message}) BETWEEN 5 AND 4000`),
    index("feedback_triage").on(table.status, table.createdAt.desc()),
  ],
);

// §8G5 — a single global flag (grievance_channel_published) is the only
// consumer so far. A small key/value table rather than a one-off column
// on some other table, since a "site configuration" concept has nowhere
// natural to live and more flags of this shape are likely (footer legal
// links going live, etc.) — never read by anything except the specific
// server-rendered surfaces that need a flag, never exposed as a generic
// settings API.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
