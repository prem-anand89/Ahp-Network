import { defineConfig } from "drizzle-kit";

// Migrations run as the database OWNER, never the restricted ahp_app runtime
// role — see CLAUDE.md's "Two database roles" rule. This connects directly
// (never through Hyperdrive, which is the app's runtime-only path) using
// DATABASE_URL, which for local dev points at the local Postgres instance
// and for real migrations is set to the Supabase project's owner connection
// string for that one invocation — never checked in, never the app's
// runtime connection.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev",
  },
  verbose: true,
  strict: true,
});
