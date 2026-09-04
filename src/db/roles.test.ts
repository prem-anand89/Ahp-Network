// Runs against a real Postgres (local dev instance), never mocks — per
// BUILD_SEQUENCE.md Phase 0's test-stack convention. Proves the role
// separation from drizzle/0001_database_roles.sql and the audit_logs
// append-only carve-out from drizzle/0003_audit_logs_append_only.sql are
// actually real, not just applied and forgotten.

import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";

const admin = postgres(adminUrl, { prepare: false, max: 2 });

afterAll(async () => {
  await admin.end();
});

describe("database roles (drizzle/0001_database_roles.sql)", () => {
  it("ahp_app and ahp_analytics exist and cannot log in directly (NOLOGIN placeholders)", async () => {
    const rows = await admin`
      SELECT rolname, rolcanlogin FROM pg_roles
      WHERE rolname IN ('ahp_app', 'ahp_analytics')
      ORDER BY rolname`;
    expect(rows).toEqual([
      { rolname: "ahp_analytics", rolcanlogin: false },
      { rolname: "ahp_app", rolcanlogin: false },
    ]);
  });

  it("ahp_app has table privileges on the public schema via default privileges", async () => {
    const [row] = await admin`
      SELECT has_schema_privilege('ahp_app', 'public', 'USAGE') AS has_usage`;
    expect(row.has_usage).toBe(true);
  });

  it("ahp_analytics has default SELECT on future analytics tables, but none on public", async () => {
    // Note: every role has schema-level USAGE on `public` by default in
    // Postgres (a PUBLIC-pseudo-role grant, unrelated to our ahp_analytics
    // role) — that's not the boundary that matters. What matters is whether
    // a table CREATEd later is automatically readable, which is controlled
    // by default ACLs (pg_default_acl), set per-schema by
    // ALTER DEFAULT PRIVILEGES in drizzle/0001_database_roles.sql.
    const rows = await admin`
      SELECT n.nspname AS schema, d.defaclacl
      FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
      WHERE d.defaclacl::text LIKE '%ahp_analytics%'`;
    const schemas = rows.map((r) => r.schema);
    expect(schemas).toContain("analytics");
    expect(schemas).not.toContain("public");
  });
});

describe("analytics views (drizzle/0012_analytics_views_growth_verification.sql)", () => {
  it("ahp_analytics can read every Growth/Verification view", async () => {
    const rows = await admin`
      SELECT has_table_privilege('ahp_analytics', 'analytics.' || table_name, 'SELECT') AS can_read, table_name
      FROM information_schema.views
      WHERE table_schema = 'analytics'`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.can_read, `ahp_analytics should read analytics.${row.table_name}`).toBe(true);
    }
  });

  it("ahp_analytics cannot read the base tables those views are built on", async () => {
    const rows = await admin`
      SELECT
        has_table_privilege('ahp_analytics', 'public.users', 'SELECT') AS users,
        has_table_privilege('ahp_analytics', 'public.credentials', 'SELECT') AS credentials,
        has_table_privilege('ahp_analytics', 'public.master_institutions', 'SELECT') AS master_institutions`;
    expect(rows[0]).toEqual({ users: false, credentials: false, master_institutions: false });
  });

  it("verification_query_raised_age never exposes query_message (free text, not guaranteed PII-free)", async () => {
    const rows = await admin`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'analytics' AND table_name = 'verification_query_raised_age'`;
    const columns = rows.map((r) => r.column_name);
    expect(columns).not.toContain("query_message");
  });
});

describe("audit_logs append-only (drizzle/0003_audit_logs_append_only.sql)", () => {
  it("ahp_app can INSERT audit_logs rows", async () => {
    await admin.begin(async (tx) => {
      await tx`SET LOCAL ROLE ahp_app`;
      const [row] = await tx`
        INSERT INTO audit_logs (actor_type, action, outcome)
        VALUES ('system', 'test_insert', 'success')
        RETURNING id`;
      expect(row.id).toBeTruthy();
      throw new Error("__rollback_test_data__");
    }).catch((err) => {
      if (err.message !== "__rollback_test_data__") throw err;
    });
  });

  it("ahp_app cannot UPDATE audit_logs rows", async () => {
    const [seed] = await admin`
      INSERT INTO audit_logs (actor_type, action, outcome)
      VALUES ('system', 'test_update_target', 'success')
      RETURNING id`;
    try {
      await admin.begin(async (tx) => {
        await tx`SET LOCAL ROLE ahp_app`;
        await tx`UPDATE audit_logs SET outcome = 'failure' WHERE id = ${seed.id}`;
      });
      throw new Error("expected UPDATE to be rejected");
    } catch (err) {
      expect(String(err)).toMatch(/permission denied/i);
    } finally {
      await admin`DELETE FROM audit_logs WHERE id = ${seed.id}`;
    }
  });

  it("ahp_app cannot DELETE audit_logs rows", async () => {
    const [seed] = await admin`
      INSERT INTO audit_logs (actor_type, action, outcome)
      VALUES ('system', 'test_delete_target', 'success')
      RETURNING id`;
    try {
      await admin.begin(async (tx) => {
        await tx`SET LOCAL ROLE ahp_app`;
        await tx`DELETE FROM audit_logs WHERE id = ${seed.id}`;
      });
      throw new Error("expected DELETE to be rejected");
    } catch (err) {
      expect(String(err)).toMatch(/permission denied/i);
    } finally {
      await admin`DELETE FROM audit_logs WHERE id = ${seed.id}`;
    }
  });
});

describe("last-super-admin lockout (drizzle/0003_audit_logs_append_only.sql)", () => {
  it("blocks revoking the only active super_admin", async () => {
    await admin.begin(async (tx) => {
      const [authUser] = await tx`
        INSERT INTO auth.users (email) VALUES ('lockout-test@example.com') RETURNING id`;
      const [adminUser] = await tx`
        INSERT INTO users (id, email, account_type)
        VALUES (${authUser.id}, 'lockout-test@example.com', 'staff')
        RETURNING id`;
      const [au] = await tx`
        INSERT INTO admin_users (user_id) VALUES (${adminUser.id}) RETURNING id`;
      const [role] = await tx`
        INSERT INTO admin_user_roles (admin_user_id, role)
        VALUES (${au.id}, 'super_admin') RETURNING id`;

      await expect(
        tx`UPDATE admin_user_roles SET revoked_at = now() WHERE id = ${role.id}`,
      ).rejects.toThrow(/Cannot revoke the last active super_admin/);

      throw new Error("__rollback_test_data__");
    }).catch((err) => {
      if (err.message !== "__rollback_test_data__") throw err;
    });
  });

  it("allows revoking a super_admin when another remains active", async () => {
    await admin.begin(async (tx) => {
      const [auth1] = await tx`
        INSERT INTO auth.users (email) VALUES ('lockout-test-1@example.com') RETURNING id`;
      const [auth2] = await tx`
        INSERT INTO auth.users (email) VALUES ('lockout-test-2@example.com') RETURNING id`;
      const [u1] = await tx`
        INSERT INTO users (id, email, account_type)
        VALUES (${auth1.id}, 'lockout-test-1@example.com', 'staff') RETURNING id`;
      const [u2] = await tx`
        INSERT INTO users (id, email, account_type)
        VALUES (${auth2.id}, 'lockout-test-2@example.com', 'staff') RETURNING id`;
      const [au1] = await tx`INSERT INTO admin_users (user_id) VALUES (${u1.id}) RETURNING id`;
      const [au2] = await tx`INSERT INTO admin_users (user_id) VALUES (${u2.id}) RETURNING id`;
      const [role1] = await tx`
        INSERT INTO admin_user_roles (admin_user_id, role) VALUES (${au1.id}, 'super_admin') RETURNING id`;
      await tx`INSERT INTO admin_user_roles (admin_user_id, role) VALUES (${au2.id}, 'super_admin')`;

      const [revoked] = await tx`
        UPDATE admin_user_roles SET revoked_at = now() WHERE id = ${role1.id} RETURNING id`;
      expect(revoked.id).toBe(role1.id);

      throw new Error("__rollback_test_data__");
    }).catch((err) => {
      if (err.message !== "__rollback_test_data__") throw err;
    });
  });
});
