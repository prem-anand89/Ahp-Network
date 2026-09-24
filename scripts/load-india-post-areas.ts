#!/usr/bin/env -S npx tsx
// Round 3 — one-time (idempotent-if-re-run) load of the India Post "All
// India Pincode Directory" (data.gov.in, Department of Posts, Government
// Open Data License – India) into the `areas` national place registry.
//
// A real .ts script run via tsx, not a plain .mjs like this repo's other
// scripts — deliberately, so it can import the tested transform logic in
// src/lib/india-post-loader.ts directly rather than duplicating it. See
// that file's header for the full design; this file is a thin CLI shell.
//
// Get the CSV first: register a free API key at data.gov.in, then
// download the "All India Pincode Directory" resource as CSV from its
// catalog page (https://www.data.gov.in/catalog/all-india-pincode-directory-through-webservice).
// This script does not fetch it itself — a one-time download the founder
// runs deliberately is a better failure mode than a script silently
// hitting a government API at build/deploy time.
//
// Usage:
//   DATABASE_URL=<owner connection string> npx tsx scripts/load-india-post-areas.ts <path-to-csv>
//
// Idempotent: re-running against an updated CSV (a later monthly refresh)
// only inserts genuinely new state/city/zone/locality rows — see
// loadIndiaPostAreasTx's own header comment for why.

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import { groupIndiaPostRows, loadIndiaPostAreasTx, parseIndiaPostCsv } from "../src/lib/india-post-loader";

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: DATABASE_URL=<owner connection string> npx tsx scripts/load-india-post-areas.ts <path-to-csv>");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Set DATABASE_URL to the migration-owner connection string first.");
    process.exit(1);
  }

  console.log(`Reading ${csvPath}...`);
  const csvText = readFileSync(csvPath, "utf8");

  console.log("Parsing...");
  const rows = parseIndiaPostCsv(csvText);
  console.log(`Parsed ${rows.length} post-office rows.`);

  console.log("Deduping (multiple post offices in the same taluk that normalize to the same locality name)...");
  const grouped = groupIndiaPostRows(rows);
  console.log(`${grouped.length} distinct localities after dedup.`);

  const sql = postgres(databaseUrl, { prepare: false, max: 1 });
  const db = drizzle(sql, { schema });

  console.log("Loading into areas (this can take a while for the full national dataset)...");
  const result = await loadIndiaPostAreasTx(db, grouped);

  console.log("Done:");
  console.log(`  states created:     ${result.statesCreated}`);
  console.log(`  cities created:     ${result.citiesCreated}`);
  console.log(`  zones created:      ${result.zonesCreated}`);
  console.log(`  localities created: ${result.localitiesCreated}`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
