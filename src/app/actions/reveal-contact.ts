"use server";

// §9 — reveal-on-tap contact for public profiles. Never in page markup;
// every reveal logged to profile_contact_reveals (distinct from the
// dormant direct-mode contact_reveals — see that table's schema comment)
// AND to audit_logs (plan's Phase 3 hardening item — "every reveal
// written to contact_reveals and audit_logs"), rate-limited on two
// independent dimensions: per IP and per anonymous-visitor session.
//
// Turnstile wired in 2026-09-21 (real keys now exist), but conditionally:
// verification is enforced only when TURNSTILE_SECRET_KEY is actually set
// in the running environment's secrets. Production and staging each need
// their own `wrangler secret put TURNSTILE_SECRET_KEY` run before this
// takes effect there — until that's done, this environment silently falls
// back to the two rate limits alone, exactly the same behaviour as
// before this change, rather than hard-failing every reveal the moment
// this code deploys somewhere the secret hasn't been set yet.

import { headers } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db/db";
import { users, profileContactReveals } from "@/db/schema";
import { decryptPublicContactValue } from "@/lib/public-contact";
import { getRuntimeEnv } from "@/lib/runtime-env";
import { getOrSetAnonSessionId, hashAnonSessionId } from "@/lib/anon-session";
import { writeAuditLog } from "@/lib/audit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import type { EncryptedEnvelope } from "@/lib/crypto";

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_REVEALS_PER_IP = 20; // per IP, per window — pilot-scale, generous enough for a genuine visitor on shared wifi
const RATE_LIMIT_MAX_REVEALS_PER_SESSION = 8; // per anon session, per window — tighter, since one visitor rarely needs this many

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

interface SecretsEnv {
  PUBLIC_CONTACT_ENCRYPTION_KEY: string;
  TURNSTILE_SECRET_KEY?: string;
}

export async function revealProfileContact(
  profileUserId: string,
  turnstileToken: string,
): Promise<{ value: string } | { error: string }> {
  const h = await headers();

  // Defense in depth alongside Next's own Server Action Origin check
  // (default-on since Next 13.4, no experimental.serverActions.allowedOrigins
  // override in next.config.ts — a cross-site browser POST is already
  // rejected by the framework before this code runs). Sec-Fetch-Site is
  // only sent by real browsers, so this can't stop a scripted client that
  // omits it — reject only the unambiguous case a real browser would
  // never send for a same-page button tap.
  const secFetchSite = h.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    return { error: "Request rejected." };
  }

  const ip = await clientIp();
  const env = await getRuntimeEnv<SecretsEnv>();

  // Conditional on purpose — see the header comment. Only enforced once
  // TURNSTILE_SECRET_KEY is actually set for this environment.
  if (env.TURNSTILE_SECRET_KEY) {
    const verified = await verifyTurnstileToken(turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
    if (!verified) {
      return { error: "Verification failed — please try again." };
    }
  }

  const db = await getDb();
  const ipHash = await hashIp(ip);
  const userAgent = h.get("user-agent");
  const sessionId = await getOrSetAnonSessionId();
  const sessionIdHash = await hashAnonSessionId(sessionId);

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const [recentByIp, recentBySession] = await Promise.all([
    db
      .select({ id: profileContactReveals.id })
      .from(profileContactReveals)
      .where(and(eq(profileContactReveals.ipHash, ipHash), gt(profileContactReveals.revealedAt, windowStart))),
    db
      .select({ id: profileContactReveals.id })
      .from(profileContactReveals)
      .where(
        and(
          eq(profileContactReveals.sessionIdHash, sessionIdHash),
          gt(profileContactReveals.revealedAt, windowStart),
        ),
      ),
  ]);

  if (recentByIp.length >= RATE_LIMIT_MAX_REVEALS_PER_IP || recentBySession.length >= RATE_LIMIT_MAX_REVEALS_PER_SESSION) {
    await writeAuditLog(db, {
      actorType: "system",
      action: "public_contact_reveal_rate_limited",
      targetTable: "users",
      targetId: profileUserId,
      outcome: "failure",
      ipAddress: ip !== "unknown" ? ip : undefined,
    });
    return { error: "Too many reveals from this network recently. Please try again later." };
  }

  const [profile] = await db
    .select({ publicContactValue: users.publicContactValue })
    .from(users)
    .where(eq(users.id, profileUserId));

  if (!profile?.publicContactValue) {
    return { error: "No contact value on file for this profile." };
  }

  const key = env.PUBLIC_CONTACT_ENCRYPTION_KEY;

  const value = await decryptPublicContactValue(
    profile.publicContactValue as EncryptedEnvelope,
    key,
  );

  // Logged AFTER a successful decrypt — a reveal that failed (no value on
  // file) isn't a real reveal event.
  await Promise.all([
    db.insert(profileContactReveals).values({ profileUserId, ipHash, sessionIdHash, userAgent }),
    writeAuditLog(db, {
      actorType: "system",
      action: "public_contact_reveal",
      targetTable: "users",
      targetId: profileUserId,
      outcome: "success",
      ipAddress: ip !== "unknown" ? ip : undefined,
    }),
  ]);

  return { value };
}
