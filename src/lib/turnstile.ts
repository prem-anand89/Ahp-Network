// Cloudflare Turnstile server-side token verification — the reveal-
// contact action's second layer of bot defense, alongside the per-IP and
// per-anonymous-session rate limits that were the only defense until real
// Turnstile keys were provisioned (2026-09-21). One POST to Cloudflare's
// siteverify endpoint; no SDK needed for something this small. See
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/.

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstileToken(
  token: string,
  secretKey: string,
  remoteIp?: string,
): Promise<boolean> {
  if (!token) return false;

  const body = new URLSearchParams({ secret: secretKey, response: token });
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body });
    if (!res.ok) return false;
    const data = (await res.json()) as { success: boolean };
    return data.success === true;
  } catch {
    // Cloudflare's own endpoint being unreachable shouldn't be
    // indistinguishable from a forged/missing token, but it also
    // shouldn't silently pass — fail closed. The caller's rate limits
    // are the fallback defense either way.
    return false;
  }
}
