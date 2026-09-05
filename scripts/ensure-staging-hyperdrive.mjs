#!/usr/bin/env node
/**
 * Idempotently create or find the staging Hyperdrive config pointing at the
 * staging Supabase session-mode pooler (port 5432). Prints the config ID to
 * stdout. Requires CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and
 * STAGING_AHP_APP_DB_PASSWORD.
 */
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const password = process.env.STAGING_AHP_APP_DB_PASSWORD;
const configName = process.env.STAGING_HYPERDRIVE_NAME ?? "ahp-network-staging-db";
const stagingRef = process.env.STAGING_SUPABASE_PROJECT_REF ?? "gkgijnzqphppudpxcifg";

if (!accountId || !apiToken || !password) {
  console.error(
    "Missing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, or STAGING_AHP_APP_DB_PASSWORD",
  );
  process.exit(1);
}

const apiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/hyperdrive/configs`;
const headers = {
  Authorization: `Bearer ${apiToken}`,
  "Content-Type": "application/json",
};

async function api(path, init = {}) {
  const res = await fetch(`${apiBase}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const body = await res.json();
  if (!body.success) {
    throw new Error(JSON.stringify(body.errors ?? body));
  }
  return body.result;
}

const origin = {
  host: "aws-0-ap-southeast-2.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  scheme: "postgresql",
  user: `ahp_app.${stagingRef}`,
  password,
};

const existing = await api("");
const found = existing.find((c) => c.name === configName);
if (found) {
  process.stdout.write(found.id);
  process.exit(0);
}

const created = await api("", {
  method: "POST",
  body: JSON.stringify({ name: configName, origin, origin_connection_limit: 20 }),
});
process.stdout.write(created.id);
