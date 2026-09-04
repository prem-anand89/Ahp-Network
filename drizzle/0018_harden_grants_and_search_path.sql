-- Hand-written migration. Two findings from a full-build review against
-- the real Supabase project, both confirmed exploitable/live, not
-- theoretical:
--
-- 1. RLS is deliberately not used (CLAUDE.md) on the reasoning that the
--    app connects as a privileged role over Hyperdrive, so a partial RLS
--    policy would read as protection that isn't there. That reasoning
--    assumes Hyperdrive/ahp_app is the ONLY path into the database — but
--    Supabase's own auto-generated PostgREST API is a separate, always-on
--    path, gated only by the `anon`/`authenticated` Postgres roles, which
--    every Supabase project grants full default CRUD on every new public
--    table (its own template, never touched by any migration here). With
--    RLS off and those grants never revoked, every table — including
--    patient_summary, credentials, audit_logs, admin_users — was readable
--    and writable by anyone holding the anon key, which is public by
--    design (shipped to the browser as NEXT_PUBLIC_SUPABASE_ANON_KEY).
--    Fix: revoke those roles' access outright. This doesn't reopen the
--    RLS decision — the app was never supposed to use anon/authenticated
--    at all, so removing their access closes the actual gap without
--    adding the partial-protection-in-disguise RLS was rejected for.
--
-- 2. shortlist_referral/accept_referral/lapse_offers (Phase 6) shipped
--    without the search_path pin that 0011 already established as this
--    project's fix for exactly this class of finding (search-path
--    hijacking: a role that can create objects earlier in the caller's
--    search_path can shadow an unqualified reference). Same fix, applied
--    to the three functions that missed it.

-- anon/authenticated are Supabase-provisioned roles, like auth.users —
-- a bare local Postgres (dev, CI) has neither, so this is guarded the
-- same way 0002's auth.users FK relies on callers stubbing Supabase
-- infrastructure rather than this migration assuming it exists.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
  END IF;
END
$$;

ALTER FUNCTION shortlist_referral(UUID, UUID, UUID[], INTERVAL, INTERVAL) SET search_path = public, pg_temp;
ALTER FUNCTION accept_referral(UUID, UUID, UUID, TEXT, INTERVAL, INTERVAL) SET search_path = public, pg_temp;
ALTER FUNCTION lapse_offers(UUID, INTERVAL) SET search_path = public, pg_temp;
