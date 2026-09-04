-- audit_logs is APPEND-ONLY at the database level (CLAUDE.md non-negotiable,
-- plan §8G). drizzle/0001_database_roles.sql's ALTER DEFAULT PRIVILEGES
-- granted ahp_app UPDATE/DELETE on every table created afterward, audit_logs
-- included — this migration is the specific carve-out, applied now that the
-- table actually exists to carve out (deferred from Phase 0 for exactly
-- this reason, see that migration's header comment).
REVOKE UPDATE, DELETE ON audit_logs FROM ahp_app;

-- Last-super-admin lockout (plan §8G5): block any revocation that would
-- leave zero active super_admins. A database trigger rather than
-- application logic — this is a genuine invariant that must hold
-- regardless of caller, the same reasoning as the referral state-transition
-- functions (CLAUDE.md's PL/pgSQL-not-client-code rule), just a much
-- simpler one: one row, one check, no concurrency race to worry about.
CREATE OR REPLACE FUNCTION prevent_last_super_admin_revocation()
RETURNS TRIGGER AS $$
DECLARE
  remaining_active_super_admins INT;
BEGIN
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL AND OLD.role = 'super_admin' THEN
    SELECT count(*) INTO remaining_active_super_admins
    FROM admin_user_roles
    WHERE role = 'super_admin' AND revoked_at IS NULL AND id != OLD.id;

    IF remaining_active_super_admins = 0 THEN
      RAISE EXCEPTION 'Cannot revoke the last active super_admin' USING ERRCODE = 'AHP99';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_user_roles_lockout_guard ON admin_user_roles;
CREATE TRIGGER admin_user_roles_lockout_guard
  BEFORE UPDATE ON admin_user_roles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_last_super_admin_revocation();
