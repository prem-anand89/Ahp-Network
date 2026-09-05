#!/usr/bin/env node
// Phase 12 pre-launch hardening: "re-verify that no referral state
// transition has been re-implemented as client-side statements." This
// replaces v18's "re-verify session-mode pooling" check — the function
// form (each transition is a single `SELECT fn(...)` call) made that
// check irrelevant; the failure condition is now a code shape, not an
// infrastructure setting. CLAUDE.md: "Never re-implement any of them as a
// sequence of client-side queries or a wrapped `db.transaction()`."
//
// Scans the files that own the referral-transaction call sites for
// `db.transaction(` (or `tx.transaction(` under any local binding name
// ending in a plausible db variable) — a real occurrence there means one
// of shortlist_referral/accept_referral/lapse_offers has been
// reimplemented client-side instead of staying a single SQL statement.
// Other files (institution-match.ts, practice-claims.ts) legitimately use
// db.transaction() for unrelated, non-referral logic and are out of scope
// for this check on purpose.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const REFERRAL_TRANSACTION_FILES = [
  "src/lib/referral-actions.ts",
  "src/lib/referral-scheduler.ts",
];

const TRANSACTION_CALL_PATTERN = /\btransaction\s*\(/;

const failures = [];

for (const relativePath of REFERRAL_TRANSACTION_FILES) {
  const path = join(process.cwd(), relativePath);
  const contents = readFileSync(path, "utf8");
  if (TRANSACTION_CALL_PATTERN.test(contents)) {
    failures.push(relativePath);
  }
}

if (failures.length > 0) {
  console.error(
    "Found a `.transaction(` call in a file that owns a referral state transition — " +
      "shortlist_referral/accept_referral/lapse_offers must stay single `SELECT fn(...)` " +
      "calls, never a client-held transaction (CLAUDE.md non-negotiable):\n" +
      failures.map((f) => `  ${f}`).join("\n"),
  );
  process.exit(1);
}

console.log(
  `✓ No client-side transaction found in the referral-transaction call sites: ${REFERRAL_TRANSACTION_FILES.join(", ")}`,
);
