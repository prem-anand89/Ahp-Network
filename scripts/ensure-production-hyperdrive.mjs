#!/usr/bin/env node
/**
 * Idempotently re-point the PRODUCTION Hyperdrive config — the one actually
 * bound in wrangler.jsonc (`hyperdrive[0].id`) — at the Mumbai (ap-south-1)
 * Supabase project's session-mode pooler (port 5432). Phase 3 of the
 * /app/* latency fix. Mirrors scripts/ensure-staging-hyperdrive.mjs's
 * origin shape.
 *
 * Targets the config by ID, never by name. An earlier version matched by
 * `name === "ahp-network-db"`, but the config actually bound in
 * wrangler.jsonc is named "ahpnetworkdb" (no hyphens) — the mismatch meant
 * every deploy since Phase 3 silently created/updated an unused config
 * while the real bound one stayed pointed at the old (now-inactive) Sydney
 * project. Production was down on every /app/* page for as long as this
 * went unnoticed, because the step still reported success. Targeting by ID
 * removes name drift as a failure mode entirely; the ID matches
 * wrangler.jsonc's `hyperdrive[0].id`, checked directly against it below
 * rather than trusted blindly, so a future rebind is a loud failure, not
 * another silent one.
 *
 * Prints the config ID to stdout. Requires CLOUDFLARE_API_TOKEN,
 * CLOUDFLARE_ACCOUNT_ID, and PROD_AHP_APP_DB_PASSWORD.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const password = process.env.PROD_AHP_APP_DB_PASSWORD;
const prodRef = process.env.PROD_SUPABASE_PROJECT_REF ?? "fuvfeqjteehgasfsxfzq";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const wranglerConfigRaw = readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8")
  // Strip // line comments only — no /* */ or trailing-comma handling needed
  // for this file today. Avoids pulling in a jsonc-parsing dependency for a
  // one-field read; if wrangler.jsonc ever grows block comments this will
  // need a real parser instead.
  .replace(/^\s*\/\/.*$/gm, "");
const wranglerConfig = JSON.parse(wranglerConfigRaw);
const boundHyperdriveId = wranglerConfig.hyperdrive?.[0]?.id;

if (!boundHyperdriveId) {
  console.error("Could not read hyperdrive[0].id out of wrangler.jsonc");
  process.exit(1);
}

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

// Fail loudly if the bound ID doesn't exist rather than falling through to
// creating yet another stray config — that silent fallback is exactly how
// the name-matching version of this script went unnoticed for a week.
await api(`/${boundHyperdriveId}`);

await api(`/${boundHyperdriveId}`, {
  method: "PATCH",
  body: JSON.stringify({ origin }),
});
process.stdout.write(boundHyperdriveId);
