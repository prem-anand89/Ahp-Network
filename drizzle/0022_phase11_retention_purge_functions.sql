-- Hand-written migration. §8H's retention matrix: "time-based purges run
-- regardless of deletion requests." src/lib/retention.ts runs most of
-- these purges directly as ahp_app (it already has UPDATE/DELETE on every
-- table except audit_logs, per drizzle/0003's append-only grant).
--
-- audit_logs is the one exception: ahp_app has UPDATE/DELETE revoked on it
-- by design (CLAUDE.md's non-negotiable — append-only is only real if the
-- app role can't undo it). A 24-month-old-row purge is still a real,
-- required part of §8H, so it runs through this one narrowly-scoped
-- SECURITY DEFINER function instead of a broader grant: it takes no
-- caller-controlled input beyond the cutoff, deletes only rows older than
-- that cutoff, and does nothing else. Owned by the migration owner, callable
-- by ahp_app, still unable to UPDATE/DELETE the table any other way.

CREATE OR REPLACE FUNCTION purge_old_audit_logs(p_older_than_months INTEGER DEFAULT 24)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM audit_logs
  WHERE created_at < now() - (p_older_than_months || ' months')::INTERVAL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

ALTER FUNCTION purge_old_audit_logs(INTEGER) SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION purge_old_audit_logs(INTEGER) TO ahp_app;
