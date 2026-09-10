#!/usr/bin/env node
/**
 * Fails the build if wrangler.jsonc's Cron Triggers and src/lib/cron-routes.ts
 * disagree, in either direction.
 *
 * Cloudflare hands the configured cron expression to the Worker as
 * `controller.cron` and worker.js looks it up by exact string. So a trigger
 * with no matching route fires into nothing, and a route with no matching
 * trigger never runs — both silently. Silent is the specific failure mode
 * this whole change exists to remove: GitHub Actions was already skipping
 * these jobs quietly, and nobody noticed until the heartbeats were read
 * directly.
 *
 * Also checks each mapped route actually exists on disk, since a renamed
 * route folder would fail the same silent way.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

/**
 * Strip JSONC comments without mangling comment-like text inside strings —
 * wrangler.jsonc holds URLs ("https://...") that a naive //-strip destroys.
 */
function stripJsonComments(source) {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        out += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      out += char;
      if (char === "\\") {
        out += source[i + 1] ?? "";
        i++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    out += char;
  }

  // Trailing commas are legal in JSONC, not in JSON.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

const wranglerConfig = JSON.parse(
  stripJsonComments(readFileSync(join(root, "wrangler.jsonc"), "utf8")),
);

const configuredCrons = wranglerConfig.triggers?.crons ?? [];

// Read the route map out of the TS source rather than importing it, so this
// stays a plain node script with no build step, like the other check-*.mjs.
const routesSource = readFileSync(join(root, "src/lib/cron-routes.ts"), "utf8");
const mapBody = routesSource.match(/CRON_ROUTES:\s*Record<string,\s*string>\s*=\s*\{([\s\S]*?)\n\};/);

if (!mapBody) {
  console.error("Could not parse CRON_ROUTES from src/lib/cron-routes.ts");
  process.exit(1);
}

const mappedRoutes = new Map();
for (const [, cron, route] of mapBody[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)) {
  mappedRoutes.set(cron, route);
}

const errors = [];

for (const cron of configuredCrons) {
  if (!mappedRoutes.has(cron)) {
    errors.push(
      `wrangler.jsonc schedules "${cron}" but src/lib/cron-routes.ts has no route for it — that trigger would fire into nothing.`,
    );
  }
}

for (const cron of mappedRoutes.keys()) {
  if (!configuredCrons.includes(cron)) {
    errors.push(
      `src/lib/cron-routes.ts maps "${cron}" but wrangler.jsonc does not schedule it — that job would never run.`,
    );
  }
}

for (const [cron, route] of mappedRoutes) {
  const routeFile = join(root, "src/app", `${route}/route.ts`);
  if (!existsSync(routeFile)) {
    errors.push(`"${cron}" maps to ${route}, but ${routeFile} does not exist.`);
  }
}

// The free plan allows 5 Cron Triggers per account; staging is pinned to an
// empty list so it does not consume any. Catch an accidental sixth here
// rather than at deploy time.
const CRON_TRIGGER_ACCOUNT_LIMIT = 5;
if (configuredCrons.length > CRON_TRIGGER_ACCOUNT_LIMIT) {
  errors.push(
    `${configuredCrons.length} Cron Triggers configured, over the free plan's account-wide limit of ${CRON_TRIGGER_ACCOUNT_LIMIT}. Workers Paid raises this to 250.`,
  );
}

const stagingCrons = wranglerConfig.env?.staging?.triggers?.crons;
if (!Array.isArray(stagingCrons) || stagingCrons.length > 0) {
  errors.push(
    'env.staging must set "triggers": { "crons": [] } explicitly — `triggers` is inheritable, so staging would otherwise run production\'s schedules against the staging database and consume the account-wide trigger budget.',
  );
}

if (errors.length > 0) {
  console.error("Cron Trigger wiring is inconsistent:\n");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `Cron Triggers wired: ${configuredCrons.length} schedule(s), each mapped to an existing route; staging pinned to none.`,
);
