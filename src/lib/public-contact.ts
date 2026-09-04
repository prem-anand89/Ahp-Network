// The pilot's one encrypted-field call site (§5, E2). Wraps src/lib/crypto.ts
// specifically for users.public_contact_value — every other field stays
// plaintext. The key comes from Cloudflare Workers Secrets
// (PUBLIC_CONTACT_ENCRYPTION_KEY, base64-encoded 256-bit AES key), never
// hardcoded. `kid` names which key encrypted a given value so rotation is
// possible later without a schema change.

import { decryptField, encryptField, importEncryptionKey, type EncryptedEnvelope } from "./crypto";

const CURRENT_KEY_ID = "key-2026-09";

export async function encryptPublicContactValue(
  plaintext: string,
  base64Key: string,
): Promise<EncryptedEnvelope> {
  const key = await importEncryptionKey(base64Key);
  return encryptField(plaintext, key, CURRENT_KEY_ID);
}

export async function decryptPublicContactValue(
  envelope: EncryptedEnvelope,
  base64Key: string,
): Promise<string> {
  const key = await importEncryptionKey(base64Key);
  return decryptField(envelope, key);
}
