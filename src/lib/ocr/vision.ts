// §8A2 — Google Cloud Vision, DOCUMENT_TEXT_DETECTION, single OCR vendor.
// REST + WebCrypto-signed service-account JWT, per plan §8A2/[v19]'s "the
// Phase 0.5-proven path" — NOT the Node SDK, which doesn't run on Workers.
//
// HONESTY NOTE, matching how ARCHITECTURE_REVIEW.md flags TGPMB: this call
// has NOT been exercised against the live Vision API. spike/README.md item
// 4 ("Google Cloud Vision from a Worker") is still "Not started," blocked
// on the founder's GCP billing activation — a real-world prerequisite this
// code can't satisfy on its own. Run the pre-launch validation plan §8A2
// requires (15-20 real/representative Tier 1 documents, including
// deliberately poor phone photos) before relying on this in production.
// The JWT-signing mechanics below follow Google's documented OAuth2
// service-account flow exactly; what's unverified is the round trip
// against Cloudflare's fetch from inside an actual Worker.

export interface VisionServiceAccountKey {
  client_email: string;
  private_key: string;
}

export interface OcrResult {
  fullText: string;
  raw: unknown;
}

const VISION_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const VISION_URL = "https://vision.googleapis.com/v1/images:annotate";

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeString(s: string): string {
  return base64UrlEncode(new TextEncoder().encode(s));
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * Mints a short-lived OAuth2 access token from a GCP service-account key,
 * signing the JWT with Web Crypto (crypto.subtle) — Workers has no Node
 * `crypto` module and the googleapis Node SDK doesn't run there.
 */
async function getAccessToken(key: VisionServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: key.client_email,
    scope: VISION_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64UrlEncodeString(JSON.stringify(header))}.${base64UrlEncodeString(JSON.stringify(claims))}`;
  const cryptoKey = await importPrivateKey(key.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64UrlEncode(signature)}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    throw new Error(`Vision OAuth token request failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Runs DOCUMENT_TEXT_DETECTION against a credential document image/PDF
 * page's bytes. Scoped permanently to credentials.document_url (Tier 1/2)
 * — never course_completions.certificate_url (plan §8A2).
 */
export async function extractText(
  key: VisionServiceAccountKey,
  imageBase64: string,
): Promise<OcrResult> {
  const accessToken = await getAccessToken(key);

  const response = await fetch(VISION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          image: { content: imageBase64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Vision API request failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    responses: [{ fullTextAnnotation?: { text: string } }];
  };
  const fullText = data.responses[0]?.fullTextAnnotation?.text ?? "";

  return { fullText, raw: data };
}
