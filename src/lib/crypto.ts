// §5's versioned encryption envelope — AES-256-GCM via Web Crypto
// (crypto.subtle), not Node's `crypto` module: this runs identically on
// Cloudflare Workers and in tests/local dev with zero polyfill, which
// matters more here than anywhere else in the app since this is the one
// piece of code handling the pilot's one encrypted field.
//
// What this buys, stated honestly (§5): protection against database
// compromise, not against disclosure. users.public_contact_value is
// revealed to the public on tap by design — this is encryption at rest,
// not access control.
//
// Never store a bare ciphertext column. Every encrypted value is this
// exact structure — without `kid`, key rotation is impossible; without a
// per-value `iv`, AES-GCM is catastrophically insecure. Both are cheap now
// and unfixable later.

export interface EncryptedEnvelope {
  v: 1;
  kid: string;
  alg: "AES-256-GCM";
  iv: string; // base64, 12 bytes
  ct: string; // base64
  tag: string; // base64, 16 bytes
}

const IV_BYTES = 12;
const TAG_BITS = 128;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Import a raw base64-encoded 256-bit key (as stored in Workers Secrets). */
export async function importEncryptionKey(base64Key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    fromBase64(base64Key) as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptField(
  plaintext: string,
  key: CryptoKey,
  kid: string,
): Promise<EncryptedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const result = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: TAG_BITS }, key, encoded),
  );

  // crypto.subtle's AES-GCM output is ciphertext with the auth tag appended
  // — split it so the envelope's ct/tag fields are genuinely separate, per
  // §5's schema.
  const tagBytes = TAG_BITS / 8;
  const ciphertext = result.slice(0, result.length - tagBytes);
  const tag = result.slice(result.length - tagBytes);

  return {
    v: 1,
    kid,
    alg: "AES-256-GCM",
    iv: toBase64(iv),
    ct: toBase64(ciphertext),
    tag: toBase64(tag),
  };
}

export async function decryptField(
  envelope: EncryptedEnvelope,
  key: CryptoKey,
): Promise<string> {
  if (envelope.v !== 1) throw new Error(`Unsupported envelope version: ${envelope.v}`);
  if (envelope.alg !== "AES-256-GCM") throw new Error(`Unsupported algorithm: ${envelope.alg}`);

  const iv = fromBase64(envelope.iv);
  const ciphertext = fromBase64(envelope.ct);
  const tag = fromBase64(envelope.tag);

  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext, 0);
  combined.set(tag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource, tagLength: TAG_BITS },
    key,
    combined as BufferSource,
  );
  return new TextDecoder().decode(decrypted);
}
