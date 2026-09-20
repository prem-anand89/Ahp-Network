// Phase 3 — a lightweight anonymous-visitor session id, so rate limits on
// public unauthenticated actions (reveal-contact.ts today) have a second
// dimension besides IP. Not an auth session — carries no identity, just a
// random id a scraper would have to preserve across requests to look like
// one visitor, same as a browser naturally does via cookies.

import { cookies } from "next/headers";

const COOKIE_NAME = "ahp_svid";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Reads the existing anonymous session id, or mints and sets a new one.
 * Must be called from a Server Action or Route Handler (not during
 * render) — cookies().set() throws otherwise. */
export async function getOrSetAnonSessionId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;
  if (existing) return existing;

  const id = crypto.randomUUID();
  store.set(COOKIE_NAME, id, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
  });
  return id;
}

export async function hashAnonSessionId(id: string): Promise<string> {
  const data = new TextEncoder().encode(id);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
