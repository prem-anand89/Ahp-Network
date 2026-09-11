// Build-failing test enforcing what src/app/app/layout.tsx's comment
// promises: every /app/* page declares `export const dynamic =
// "force-dynamic"` itself. This used to live on the shared layout instead
// — removed after a real production crash traced to exactly that
// combination (a dynamic layout forces its whole subtree into one SSR
// unit, colliding with each page's own Suspense boundary and surfacing as
// React error #419 on navigation between /app/* routes). Moving the
// declaration to each page fixes the crash, but only if every page
// actually carries it — a page with no dynamic API call of its own (a
// plain client-form page, say) would otherwise silently qualify for
// build-time static generation, serving one frozen response to every
// signed-in therapist. This test is what makes that a build failure
// instead of a silent regression discoverable only via `next build`'s
// route listing.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const APP_DIR = join(process.cwd(), "src", "app", "app");
const REQUIRED_DECLARATION = /export const dynamic = ["']force-dynamic["'];/;

function findPageFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      found.push(...findPageFiles(fullPath));
    } else if (entry === "page.tsx") {
      found.push(fullPath);
    }
  }
  return found;
}

describe("every /app/* page declares force-dynamic itself", () => {
  const pageFiles = findPageFiles(APP_DIR);

  it("found at least one /app/* page to check", () => {
    // A guard against this test silently checking nothing if the
    // directory structure ever changes.
    expect(pageFiles.length).toBeGreaterThan(0);
  });

  it.each(pageFiles)("%s", (file) => {
    const source = readFileSync(file, "utf8");
    expect(REQUIRED_DECLARATION.test(source)).toBe(true);
  });
});
