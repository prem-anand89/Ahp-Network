-- Three database roles, per CLAUDE.md's non-negotiable: migrations run as
-- the owner (Supabase's default `postgres` role — never altered here);
-- the app connects at runtime as the restricted `ahp_app`; a third role,
-- `ahp_analytics`, can read the `analytics` schema's views and nothing
-- else. Append-only on audit_logs (Phase 1) is only real once the app role
-- is a different role from the one that granted it — this migration
-- establishes that separation before any table exists to protect.
--
-- The audit_logs-specific `REVOKE UPDATE, DELETE` happens in the Phase 1
-- migration that creates audit_logs — it can't be expressed before the
-- table exists. Everything here is the reusable pattern: baseline grants
-- plus default privileges, so every future table created by the owner is
-- automatically usable by ahp_app without a per-table grant statement.
--
-- Passwords: NOT set here. `ahp_app`/`ahp_analytics` are created NOLOGIN
-- placeholders in this migration (safe to commit, safe to re-run against
-- any environment including CI). Each real environment (local dev, the
-- actual Supabase project) gets its password set out-of-band via
-- `ALTER ROLE ... WITH LOGIN PASSWORD '...'`, run once and never committed.
-- Wiring Hyperdrive's origin user to `ahp_app` is a Phase 1 follow-up, once
-- there are real tables to verify the grants against end-to-end.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ahp_app') THEN
    CREATE ROLE ahp_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ahp_analytics') THEN
    CREATE ROLE ahp_analytics NOLOGIN;
  END IF;
END
$$;

-- ahp_app: full read/write on the public schema's tables and sequences,
-- including ones created after this migration runs (ALTER DEFAULT
-- PRIVILEGES), so Phase 1+ tables don't each need a manual grant.
GRANT USAGE ON SCHEMA public TO ahp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ahp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ahp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ahp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ahp_app;

-- ahp_analytics: a home schema for read-only views, never granted anything
-- on public directly — see BUILD_SEQUENCE.md Phase 0's "analytics view
-- layer" note. Views land in Phase 1+ once base tables exist; this creates
-- the schema and the role's access to it now so nothing is retrofitted.
CREATE SCHEMA IF NOT EXISTS analytics;
GRANT USAGE ON SCHEMA analytics TO ahp_analytics;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics
  GRANT SELECT ON TABLES TO ahp_analytics;
