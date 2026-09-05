#!/usr/bin/env node
/**
 * Patch wrangler.jsonc env.staging hyperdrive binding ID in-place.
 * Usage: node scripts/patch-wrangler-staging-hyperdrive.mjs <hyperdrive-id>
 */
import fs from "node:fs";

const hyperdriveId = process.argv[2];
if (!hyperdriveId) {
  console.error("Usage: patch-wrangler-staging-hyperdrive.mjs <hyperdrive-id>");
  process.exit(1);
}

const path = "wrangler.jsonc";
let content = fs.readFileSync(path, "utf8");
const stagingBlock = /("env"\s*:\s*\{[\s\S]*?"staging"\s*:\s*\{[\s\S]*?"hyperdrive"\s*:\s*\[\s*\{[\s\S]*?"id"\s*:\s*")([^"]+)(")/;
if (!stagingBlock.test(content)) {
  console.error("Could not find env.staging.hyperdrive[0].id in wrangler.jsonc");
  process.exit(1);
}
content = content.replace(stagingBlock, `$1${hyperdriveId}$3`);
fs.writeFileSync(path, content);
console.log("Patched staging Hyperdrive ID:", hyperdriveId);
