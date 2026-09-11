#!/usr/bin/env node
/**
 * Idempotently create or update the PRODUCTION Hyperdrive config to point at
 * the Mumbai (ap-south-1) Supabase project's session-mode pooler (port
 * 5432) — Phase 3 of the /app/* latency fix. Mirrors
 * scripts/ensure-staging-hyperdrive.mjs's origin shape exactly; the only
 * difference is region and that this one UPDATEs an existing config rather
 * than only creating one, since production's Hyperdrive config already
 * exists (id 788ce466573445f9aeac98d779e84774, pointed at the old Sydney
 * project) and needs re-pointing, not a fresh create.
 *
 * Prints the config ID to stdout. Requires CLOUDFLARE_API_TOKEN,
 * CLOUDFLARE_ACCOUNT_ID, and PROD_AHP_APP_DB_PASSWORD.
 */
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const password = process.env.PROD_AHP_APP_DB_PASSWORD;
const configName = process.env.PROD_HYPERDRIVE_NAME ?? "ahp-network-db";
const prodRef = process.env.PROD_SUPABASE_PROJECT_REF ?? "fuvfeqjteehgasfsxfzq";

if (!accountId || !apiToken || !password) {
  console.error("Missing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, or PROD_AHP_APP_DB_PASSWORD");
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

// Session-mode pooler, ap-south-1 — never the transaction-mode pooler
// (port 6543): CLAUDE.md / spike/README.md's non-negotiable, verified the
// hard way in Phase 0.5 (stacking Hyperdrive on Supavisor transaction mode
// breaks every connection regardless of load).
const origin = {
  host: "aws-0-ap-south-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  scheme: "postgresql",
  user: `ahp_app.${prodRef}`,
  password,
};

const existing = await api("");
const found = existing.find((c) => c.name === configName);

if (found) {
  await api(`/${found.id}`, {
    method: "PATCH",
    body: JSON.stringify({ origin }),
  });
  process.stdout.write(found.id);
  process.exit(0);
}

const created = await api("", {
  method: "POST",
  body: JSON.stringify({ name: configName, origin, origin_connection_limit: 20 }),
});
process.stdout.write(created.id);
