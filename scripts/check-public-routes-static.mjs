#!/usr/bin/env node
// CI assertion, per BUILD_SEQUENCE.md Phase 0 (§B2): a single cookies() or
// headers() call anywhere in the (public) route group's layout chain
// silently opts the whole SEO-facing directory into dynamic rendering —
// nothing errors, it just stops being static. Run this after `next build`.
//
// Reads .next/app-path-routes-manifest.json to find every route sourced
// from app/(public)/..., then checks .next/prerender-manifest.json to
// confirm each one is prerendered as static or ISR (never fully dynamic).

import { readFileSync } from "node:fs";
import { join } from "node:path";

const nextDir = join(process.cwd(), ".next");

const appPathRoutes = JSON.parse(
  readFileSync(join(nextDir, "app-path-routes-manifest.json"), "utf8"),
);
const prerenderManifest = JSON.parse(
  readFileSync(join(nextDir, "prerender-manifest.json"), "utf8"),
);

const publicRoutes = Object.entries(appPathRoutes)
  .filter(([sourcePath]) => sourcePath.startsWith("/(public)/"))
  .map(([, routePath]) => routePath);

if (publicRoutes.length === 0) {
  console.error("No routes found under app/(public)/ — did the route group get removed?");
  process.exit(1);
}

const staticRoutes = new Set(Object.keys(prerenderManifest.routes ?? {}));
const isrRoutes = new Set(Object.keys(prerenderManifest.dynamicRoutes ?? {}));

const failures = publicRoutes.filter(
  (route) => !staticRoutes.has(route) && !isrRoutes.has(route),
);

if (failures.length > 0) {
  console.error(
    "The following (public) routes are NOT static/ISR — a dynamic API call " +
      "(cookies()/headers()/etc.) has leaked into the public layout chain:\n" +
      failures.map((r) => `  ${r}`).join("\n"),
  );
  process.exit(1);
}

console.log(`✓ All ${publicRoutes.length} (public) route(s) are static/ISR: ${publicRoutes.join(", ")}`);
