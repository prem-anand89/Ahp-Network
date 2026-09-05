// Build-failing test enforcing plan §1A's most-repeated, easiest-to-erode
// non-negotiable: no ranking, scoring, star, or rating language, anywhere,
// ever. "Top therapists in Kondapur" is a natural thing to write and a
// violation — ARCHITECTURE_REVIEW.md C4 exists specifically because a rule
// this easy to break by accident needs a test, not just discipline.
//
// Scans raw source text (not just string literals) with word boundaries,
// so "started" and "laptop" don't false-positive on "star"/"top" — real
// violations use these as whole words ("top-rated", "5-star", "highest
// score"). A genuine false positive gets fixed by rewording, not by
// weakening the pattern; ALLOWLIST exists for the rare case that can't be
// reworded (there are none yet).

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const BANNED_PATTERN = /\b(rating|ratings|score|scores|scored|star|stars|starred|rank|ranks|ranked|ranking|top|best)\b/i;

const SCAN_ROOT = join(process.cwd(), "src");
const SCAN_EXTENSIONS = new Set([".ts", ".tsx"]);
const EXCLUDE_SUFFIXES = [".test.ts", ".test.tsx"];
const EXCLUDE_DIRS = new Set(["node_modules", "ui"]); // src/components/ui — shadcn primitives, not copy

// Reviewed exceptions — each entry is a specific, deliberate decision, not
// a way to silence a future real violation.
const ALLOWLIST: { file: string; word: string }[] = [
  // Tailwind's `top-0` positioning utility (sticky header offset) — CSS
  // "distance from the top of the viewport," unrelated to ranking. No
  // rewording avoids this: the word "top" is the actual Tailwind class
  // name, not copy describing anything about therapists.
  { file: "src/components/app-nav.tsx", word: "top" },
  // Skip-link focus ring positioning (focus:top-4) — same Tailwind utility
  // rationale as app-nav.tsx above.
  { file: "src/app/layout.tsx", word: "top" },
];

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (SCAN_EXTENSIONS.has(extname(entry)) && !EXCLUDE_SUFFIXES.some((s) => entry.endsWith(s))) {
      out.push(full);
    }
  }
  return out;
}

describe("no-ranking copy scan (plan §1A)", () => {
  it("finds no rating/scoring/ranking language in any source file", () => {
    const violations: { file: string; word: string }[] = [];

    for (const file of collectSourceFiles(SCAN_ROOT)) {
      const content = readFileSync(file, "utf8");
      const match = content.match(BANNED_PATTERN);
      if (!match) continue;

      const relative = file.replace(process.cwd() + "/", "");
      const word = match[0].toLowerCase();
      const allowed = ALLOWLIST.some((a) => a.file === relative && a.word === word);
      if (!allowed) violations.push({ file: relative, word });
    }

    expect(
      violations,
      violations.length
        ? `Ranking/scoring language found:\n${violations
            .map((v) => `  ${v.file}: "${v.word}"`)
            .join("\n")}\nPlan §1A: no ranking, scoring, star, or rating language, anywhere, ever. If this is a genuine false positive, reword rather than weaken the pattern.`
        : undefined,
    ).toEqual([]);
  });
});
