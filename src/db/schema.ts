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
  uniqueIndex,
  index,
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
