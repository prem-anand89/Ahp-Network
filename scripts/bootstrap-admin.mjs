#!/usr/bin/env node
// Bootstrap the first super_admin — plan §8G5: "Seed migration or CLI
// command for the first super-admin, documented." This is that CLI
// command, deliberately not a migration: the target user must already
// exist (have signed in at least once via Supabase Auth), and running this
// against the wrong environment by accident is a much worse failure mode
// for a migration than for a script a human runs deliberately, once, by
// email address.
//
// Usage:
//   DATABASE_URL=<owner connection string> node scripts/bootstrap-admin.mjs someone@example.com
//
// Idempotent: running it again for the same email is a no-op if that
// person is already an active super_admin.

import postgres from "postgres";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/bootstrap-admin.mjs <email>");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Set DATABASE_URL to the migration-owner connection string first.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { prepare: false, max: 1 });

try {
  const [user] = await sql`SELECT id FROM users WHERE email = ${email} AND deleted_at IS NULL`;
  if (!user) {
    console.error(
      `No users row for ${email} — they need to sign in at least once first (the users row is created on first sign-in, not by this script).`,
    );
    process.exit(1);
  }

  const [adminUser] = await sql`
    INSERT INTO admin_users (user_id)
    VALUES (${user.id})
    ON CONFLICT (user_id) DO NOTHING
    RETURNING id`;

  const adminUserId =
    adminUser?.id ??
    (await sql`SELECT id FROM admin_users WHERE user_id = ${user.id}`)[0]?.id;

  const [existingActive] = await sql`
    SELECT id FROM admin_user_roles
    WHERE admin_user_id = ${adminUserId} AND role = 'super_admin' AND revoked_at IS NULL`;

  if (existingActive) {
    console.log(`${email} is already an active super_admin. Nothing to do.`);
  } else {
    await sql`
      INSERT INTO admin_user_roles (admin_user_id, role)
      VALUES (${adminUserId}, 'super_admin')`;
    console.log(`${email} is now a super_admin.`);
  }
} finally {
  await sql.end();
}
