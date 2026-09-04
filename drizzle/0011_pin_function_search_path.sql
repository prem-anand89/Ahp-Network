-- Hand-written migration. Fixes a real finding from Supabase's security
-- advisor after drizzle/0010: PL/pgSQL functions without a pinned
-- search_path are vulnerable to search-path hijacking (a role that can
-- create objects in a schema earlier in the caller's search_path can
-- shadow an unqualified reference). Pinning search_path = public, pg_temp
-- closes that regardless of who calls the function or what their session
-- search_path is set to.

ALTER FUNCTION recompute_verification_stage(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION sync_degree_to_course_completion(UUID) SET search_path = public, pg_temp;

-- Same finding, pre-existing from drizzle/0003 (the last-super-admin
-- lockout trigger function) -- fixed alongside since it's the identical
-- one-line class of issue, caught by the same advisor pass.
ALTER FUNCTION prevent_last_super_admin_revocation() SET search_path = public, pg_temp;
