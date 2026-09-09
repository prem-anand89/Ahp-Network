-- Security fix, found via Supabase's own advisor lints (not a build-time
-- catch): drizzle/0022 granted EXECUTE on purge_old_audit_logs() to
-- ahp_app but never revoked Postgres's default EXECUTE-to-PUBLIC grant a
-- function gets on creation. Supabase's PostgREST layer exposes public-
-- schema functions to the `anon` and `authenticated` roles by extension of
-- that PUBLIC grant, so this SECURITY DEFINER function — which deletes
-- rows from audit_logs, the one table CLAUDE.md requires stay
-- append-only at the database level — was callable by literally anyone
-- on the internet via POST /rest/v1/rpc/purge_old_audit_logs, with a
-- caller-controlled p_older_than_months (as low as 0, deleting every row
-- immediately). ahp_app's own inability to UPDATE/DELETE audit_logs
-- directly (drizzle/0003) was never the actual gap; this RPC exposure was.
--
-- Revoking from PUBLIC alone does not close this: Supabase auto-grants
-- EXECUTE on every new public-schema function directly to anon and
-- authenticated (not merely via inherited PUBLIC privileges), confirmed
-- by querying information_schema.routine_privileges after the PUBLIC
-- revoke alone left both roles still listed. service_role is left
-- untouched deliberately — it is Supabase's fully-trusted backend key,
-- already equivalent to bypassing this kind of restriction by design,
-- and this app's own server code never calls this function through it
-- anyway (retention.ts calls it over Hyperdrive as ahp_app).
REVOKE EXECUTE ON FUNCTION purge_old_audit_logs(INTEGER) FROM PUBLIC;

-- anon/authenticated only exist on a real Supabase project, not the bare
-- Postgres containers CI and local dev run against (drizzle/0018 already
-- established this guard pattern for the same reason).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION purge_old_audit_logs(INTEGER) FROM anon, authenticated';
  END IF;
END
$$;
