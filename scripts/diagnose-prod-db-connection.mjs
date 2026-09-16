// Temporary diagnostic, not a permanent part of the deploy pipeline.
//
// The "Apply migrations to production database" step has failed twice
// (run #55, both attempts) with zero error detail in the GitHub Actions
// log — GitHub redacts any log line containing the literal PROD_DB_URL
// secret value, and drizzle-kit's underlying postgres.js error message
// embeds the full connection string, so the entire line vanishes instead
// of just the secret substring. This script makes the same connection
// attempt directly and logs only fields that can never contain the
// secret (error name/code/errno, and the host/port it *parsed* out of
// the URL, never the password) so the real failure reason is visible.
//
// Delete this file and its workflow step once the real cause is found
// and fixed — it exists to answer one question, not to become permanent
// tooling.
import postgres from "postgres";
import crypto from "node:crypto";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set in this step's env.");
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(url);
} catch (e) {
  console.error("DATABASE_URL is not a parseable URL:", e.message);
  process.exit(1);
}

// The password as this script sees it, decoded from the URL — this is
// exactly what gets sent to Postgres, so the fingerprint below reflects
// the real auth attempt, not just what's typed into the secret box.
const password = decodeURIComponent(parsed.password);
const passwordUtf8Bytes = Buffer.byteLength(password, "utf8");
const fingerprint = crypto.createHash("sha256").update(password, "utf8").digest("hex").slice(0, 8);

console.log("Attempting connection with:");
console.log("  host:", parsed.hostname);
console.log("  port:", parsed.port || "(default)");
console.log("  user:", parsed.username);
console.log("  database:", parsed.pathname.replace(/^\//, ""));
console.log("  password length (chars):", password.length);
console.log("  password length (utf8 bytes):", passwordUtf8Bytes, passwordUtf8Bytes !== password.length ? "<-- MISMATCH: non-ASCII characters present (smart quotes? curly apostrophes from a copy-paste?)" : "");
console.log("  password has leading/trailing whitespace:", password !== password.trim());
console.log("  password SHA-256 fingerprint (first 8 hex chars):", fingerprint);
console.log("  -> To confirm this matches the password you intended, run this in any browser's");
console.log("     devtools console (paste your intended password in place of PASSWORD):");
console.log("     crypto.subtle.digest('SHA-256', new TextEncoder().encode('PASSWORD')).then(b=>console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,8)))");
console.log("     If the 8 hex characters it prints don't match the fingerprint above, the secret");
console.log("     doesn't contain the password you think it does.");

const sql = postgres(url, { max: 1, connect_timeout: 10 });

try {
  const rows = await sql`select 1 as ok`;
  console.log("Connection succeeded:", rows);
} catch (e) {
  console.log("Connection failed. Sanitized error details:");
  console.log("  name:", e.name);
  console.log("  code:", e.code);
  console.log("  errno:", e.errno);
  console.log("  syscall:", e.syscall);
  console.log("  address:", e.address);
  console.log("  port:", e.port);
  // Message can embed the connection string — strip anything that looks
  // like a postgres:// URL before printing it.
  const safeMessage = String(e.message ?? "").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted-url]");
  console.log("  message:", safeMessage);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
