// Build-failing test enforcing plan §1A's most-repeated, easiest-to-erode
// non-negotiable: no ranking, scoring, star, or rating language, anywhere,
// ever. "Top therapists in Kondapur" is a natural thing to write and a
// violation — ARCHITECTURE_REVIEW.md C4 exists specifically because a rule
// this easy to break by accident needs a test, not just discipline.
//
// Scans raw source text (not just string literals) with word boundaries,
// so "started" and "laptop" don't false-positive on "star"/"top" — real
// violations use these as whole words ("top-rated", "5-star", "highest
// score").
//
// [2026-09] Rewritten as part of the design-system overhaul, which adds a
// floating nav, sticky filter bars, a mobile tab bar, sheets, and modal
// centering — all of which use Tailwind's `top-*` positioning utility, a
// CSS distance-from-viewport-edge value that has nothing to do with
// ranking. The previous approach (a hand-maintained ALLOWLIST of
// file+word pairs) does not scale to that: every new sticky/floating
// element would need its own allowlist entry and doc edit.
//
// This version is a NET STRENGTHENING of the guarantee, not a loosening:
//   1. It strips only provably-Tailwind `top-<value>` constructs before
//      matching — `top-0`, `focus:top-4`, `sticky top-[72px]`, `-top-1/2`,
//      `md:top-6` all vanish, because `<value>` there is restricted to
//      Tailwind's actual grammar (0, px, auto, full, a bare number, a
//      fraction, or an arbitrary `[...]` value). "top-rated" does NOT
//      match that grammar (`rated` isn't a Tailwind value), so it still
//      trips the scan — which is the literal example this test's header
//      cites as the violation it exists to catch.
//   2. The previous version used `content.match()` with no `/g` flag, so
//      it only ever inspected the FIRST banned word in a file. A file
//      allowlisted for "top" could have silently shipped a later "best"
//      or "ranking" with no warning. This version uses `matchAll` and
//      reports every distinct violation per file.
//   3. "rated" is added to the banned-word list — a real copy violation
//      ("highly rated") that slipped through the previous word list.
//      "scoring" was considered and deliberately NOT added: in this
//      codebase it names the admin-only OCR confidence mechanism that
//      CLAUDE.md explicitly authorizes ("OCR and scoring only prioritize
//      the admin queue"), and appears in `credential-scoring.ts` and the
//      comments around it — never in user-facing copy. The user-facing
//      risk is already covered by score/scores/scored.
//   4. The ALLOWLIST is gone entirely. Nothing needs one now that the
//      Tailwind-`top` construct is recognized structurally instead of by
//      hand-listing every file that legitimately uses it.
//
// A genuine false positive (should there ever be one) gets fixed by
// rewording the copy, not by weakening BANNED_PATTERN or the strip logic.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const BANNED_PATTERN =
  /\b(rating|ratings|rated|score|scores|scored|star|stars|starred|rank|ranks|ranked|ranking|top|best)\b/gi;

// Matches a Tailwind `top-*` utility (with optional leading `-` for a
// negative value, and any number of `variant:` prefixes) whose value is
// one of Tailwind's actual accepted forms for an inset utility: the bare
// keywords, a plain integer (the spacing scale), a `<n>/<n>` fraction, or
// an arbitrary `[...]` value. This is deliberately a strict allowlist of
// SHAPES, not of specific files — "top-rated" can never match this,
// because `rated` is none of those forms.
const TAILWIND_TOP_UTILITY =
  /(?:[a-z0-9-]+:)*-?top-(?:0|px|auto|full|\d+(?:\/\d+)?|\[[^\]]+\])(?=[\s"'`)]|$)/gi;

const SCAN_ROOT = join(process.cwd(), "src");
const SCAN_EXTENSIONS = new Set([".ts", ".tsx"]);
const EXCLUDE_SUFFIXES = [".test.ts", ".test.tsx"];
const EXCLUDE_DIRS = new Set(["node_modules", "ui"]); // src/components/ui — shadcn primitives, not copy

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

/** Every distinct banned word found in `content`, after stripping Tailwind `top-*` utilities. */
function findBannedWords(content: string): string[] {
  const withoutTailwindTop = content.replace(TAILWIND_TOP_UTILITY, "");
  const words = new Set<string>();
  for (const match of withoutTailwindTop.matchAll(BANNED_PATTERN)) {
    words.add(match[0].toLowerCase());
  }
  return [...words];
}

describe("no-ranking copy scan (plan §1A)", () => {
  it("finds no rating/scoring/ranking language in any source file", () => {
    const violations: { file: string; word: string }[] = [];

    for (const file of collectSourceFiles(SCAN_ROOT)) {
      const content = readFileSync(file, "utf8");
      const relative = file.replace(process.cwd() + "/", "");
      for (const word of findBannedWords(content)) {
        violations.push({ file: relative, word });
      }
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

  // Proof that the Tailwind-`top` carve-out is structural, not a loophole:
  // real violations still fail, and every real positioning construct the
  // design-system overhaul introduces still passes.
  describe("the top-* carve-out", () => {
    it("still catches real ranking/rating violations", () => {
      // "top-rated" trips on BOTH words now — `top` (not a Tailwind value
      // follows it) and `rated` (newly banned).
      expect(findBannedWords("Showing top-rated therapists in Kondapur")).toEqual(["top", "rated"]);
      expect(findBannedWords("the best therapists in Kondapur")).toEqual(["best"]);
      expect(findBannedWords("a highly rated professional")).toEqual(["rated"]);
      expect(findBannedWords("the highest score wins")).toEqual(["score"]);
    });

    it("does not false-positive on Tailwind top-* positioning utilities", () => {
      expect(findBannedWords('<div className="sticky top-0 z-10">')).toEqual([]);
      expect(findBannedWords('className="focus:top-4"')).toEqual([]);
      expect(findBannedWords('className="sticky top-[72px] md:top-6"')).toEqual([]);
      expect(findBannedWords('className="-top-1/2"')).toEqual([]);
      // Multiple variants stacked, as a real responsive floating nav needs.
      expect(findBannedWords('className="top-4 sm:top-6 lg:top-8"')).toEqual([]);
    });
  });
});
