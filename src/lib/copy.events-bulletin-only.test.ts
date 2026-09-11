// Build-failing test enforcing that community events stay bulletin-only —
// "no RSVP, no capacity... that restriction never changes, for any
// community type" (CLAUDE.md's [H3] note). This is the line between the
// free community tier and the future paid courses/events product: a free
// event post can announce, it cannot let anyone register, fill a seat, or
// join a waitlist. It is currently held only by that sentence in CLAUDE.md
// and by discipline — this test gives it the same structural backing the
// no-ranking rule already has (copy.no-ranking.test.ts), rather than
// waiting to notice the line was crossed after a follow-up request made
// "lightweight RSVP tracking" sound reasonable in isolation.
//
// Scoped to community-feature code specifically, not the whole app —
// "capacity" and similar words show up legitimately elsewhere (e.g. an
// unrelated admin-review time-capacity estimate). Scanning only the files
// that implement communities/events keeps the signal real.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const BANNED_PATTERN = /\b(rsvp|capacity|attendee|attendees|waitlist|waitlisted)\b/i;

// Every file/directory that implements the communities feature — new
// community-related files should be added here, not left unscanned.
const SCAN_PATHS = [
  "src/app/app/community",
  "src/app/app/communities",
  "src/app/admin/(protected)/communities",
  "src/lib/communities.ts",
  "src/lib/community-auto-generation.ts",
  "src/lib/community-moderators.ts",
];

const SCAN_EXTENSIONS = new Set([".ts", ".tsx"]);
const EXCLUDE_SUFFIXES = [".test.ts", ".test.tsx"];

// Reviewed exceptions — each entry is a specific, deliberate decision, not
// a way to silence a future real violation.
const ALLOWLIST: { file: string; word: string }[] = [
  // Declares the restriction itself ("No comments, no reply threads, no
  // RSVP — by schema design"), not a feature that implements one.
  { file: "src/app/app/community/page.tsx", word: "rsvp" },
];

function collectSourceFiles(root: string, out: string[] = []): string[] {
  const stat = statSync(root);
  if (stat.isFile()) {
    if (SCAN_EXTENSIONS.has(extname(root)) && !EXCLUDE_SUFFIXES.some((s) => root.endsWith(s))) {
      out.push(root);
    }
    return out;
  }
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const entryStat = statSync(full);
    if (entryStat.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (SCAN_EXTENSIONS.has(extname(entry)) && !EXCLUDE_SUFFIXES.some((s) => entry.endsWith(s))) {
      out.push(full);
    }
  }
  return out;
}

describe("events stay bulletin-only ([H3])", () => {
  it("finds no RSVP/capacity/attendee/waitlist identifier in community-feature code", () => {
    const violations: { file: string; word: string }[] = [];

    for (const scanPath of SCAN_PATHS) {
      const absolute = join(process.cwd(), scanPath);
      for (const file of collectSourceFiles(absolute)) {
        const content = readFileSync(file, "utf8");
        const match = content.match(BANNED_PATTERN);
        if (!match) continue;

        const relative = file.replace(process.cwd() + "/", "");
        const word = match[0].toLowerCase();
        const allowed = ALLOWLIST.some((a) => a.file === relative && a.word === word);
        if (!allowed) violations.push({ file: relative, word });
      }
    }

    expect(
      violations,
      violations.length
        ? `RSVP/capacity/attendee/waitlist language found in community code:\n${violations
            .map((v) => `  ${v.file}: "${v.word}"`)
            .join("\n")}\nEvent posts are bulletin-only, no RSVP or capacity, for every community type — this restriction never changes (CLAUDE.md [H3]). If this is a genuine false positive, reword rather than weaken the pattern.`
        : undefined,
    ).toEqual([]);
  });
});
