#!/usr/bin/env node
// CI assertion, per BUILD_SEQUENCE.md Phase 0 (§B2): a single cookies() or
// headers() call anywhere in the (public) route group's layout chain
// silently opts the whole SEO-facing directory into dynamic rendering —
// nothing errors, it just stops being static. Run this after `next build`.
//
// Reads .next/app-path-routes-manifest.json to find every route sourced
// from app/(public)/..., then checks .next/prerender-manifest.json to
// confirm each one is prerendered as static or ISR (never fully dynamic).
//
// [Phase 5] Two genuinely expected reasons a (public) route can't be
// static/ISR, neither of them the silent leak this check exists to catch:
// (1) it reads searchParams for live filtering (the directory search
// page), or (2) it calls getDb(), which needs the Hyperdrive binding from
// the live Worker's request context — unavailable at build time, so ANY
// route touching the database renders per-request regardless of whether
// it also reads cookies()/headers(). Both are exempted ONLY if the source
// file contains an explicit `export const dynamic = "force-dynamic"`
// declaration — visible in code review, unlike a cookies()/headers() call
// buried in a shared layout. A route with neither static/ISR output nor
// that declaration still fails.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const nextDir = join(process.cwd(), ".next");
const appDir = join(process.cwd(), "src", "app");

const appPathRoutes = JSON.parse(
  readFileSync(join(nextDir, "app-path-routes-manifest.json"), "utf8"),
);
const prerenderManifest = JSON.parse(
  readFileSync(join(nextDir, "prerender-manifest.json"), "utf8"),
);

const publicRouteEntries = Object.entries(appPathRoutes).filter(([sourcePath]) =>
  sourcePath.startsWith("/(public)/"),
);

if (publicRouteEntries.length === 0) {
  console.error("No routes found under app/(public)/ — did the route group get removed?");
  process.exit(1);
}

const staticRoutes = new Set(Object.keys(prerenderManifest.routes ?? {}));
const isrRoutes = new Set(Object.keys(prerenderManifest.dynamicRoutes ?? {}));

function declaresForceDynamic(sourcePath) {
  // sourcePath looks like "/(public)/directory/page" for a normal page,
  // or "/(public)/pt/[slug]/opengraph-image-1kku43/route" for a metadata
  // route (opengraph-image, twitter-image, icon, ...) — Next appends a
  // trailing "/route" segment and a random hash to the manifest entry
  // name, neither of which exists in the real filename. Strip both
  // before resolving to a file under src/app.
  const withoutRouteSuffix = sourcePath.replace(/\/route$/, "");
  const dehashed = withoutRouteSuffix.replace(/-[a-z0-9]{4,8}$/, "");
  for (const candidatePath of [sourcePath, withoutRouteSuffix, dehashed]) {
    for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
      const candidate = join(appDir, candidatePath + ext);
      if (existsSync(candidate)) {
        return /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/.test(
          readFileSync(candidate, "utf8"),
        );
      }
    }
  }
  return false;
}

const failures = publicRouteEntries.filter(
  ([sourcePath, routePath]) =>
    !staticRoutes.has(routePath) && !isrRoutes.has(routePath) && !declaresForceDynamic(sourcePath),
);

if (failures.length > 0) {
  console.error(
    "The following (public) routes are NOT static/ISR, and don't declare an " +
      "explicit `export const dynamic = \"force-dynamic\"` — a dynamic API call " +
      "(cookies()/headers()/etc.) may have leaked into the public layout chain:\n" +
      failures.map(([, routePath]) => `  ${routePath}`).join("\n"),
  );
  process.exit(1);
}

const publicRoutes = publicRouteEntries.map(([, routePath]) => routePath);
console.log(`✓ All ${publicRoutes.length} (public) route(s) are static/ISR/declared-dynamic: ${publicRoutes.join(", ")}`);
