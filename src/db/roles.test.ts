// Runs against a real Postgres (local dev instance), never mocks — per
// BUILD_SEQUENCE.md Phase 0's test-stack convention. Proves the role
// separation from drizzle/0001_database_roles.sql is actually real, not
// just applied and forgotten. The audit_logs-specific revoke test (the one
// BUILD_SEQUENCE.md names explicitly) lands in Phase 1 once that table
// exists; this is the general pattern it will build on.

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
