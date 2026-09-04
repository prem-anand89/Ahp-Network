"use server";

// §9 — reveal-on-tap contact for public profiles. Never in page markup;
// every reveal logged to profile_contact_reveals (distinct from the
// dormant direct-mode contact_reveals — see that table's schema comment),
// rate-limited per IP.

import { headers } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db/db";
import { users, profileContactReveals } from "@/db/schema";
import { decryptPublicContactValue } from "@/lib/public-contact";
import type { EncryptedEnvelope } from "@/lib/crypto";

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_REVEALS = 20; // per IP, per window — pilot-scale, generous enough for a genuine visitor

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
}

export async function revealProfileContact(
  profileUserId: string,
): Promise<{ value: string } | { error: string }> {
  const db = await getDb();
  const ip = await clientIp();
  const ipHash = await hashIp(ip);
  const h = await headers();
  const userAgent = h.get("user-agent");

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recentReveals = await db
    .select({ id: profileContactReveals.id })
    .from(profileContactReveals)
    .where(and(eq(profileContactReveals.ipHash, ipHash), gt(profileContactReveals.revealedAt, windowStart)));

  if (recentReveals.length >= RATE_LIMIT_MAX_REVEALS) {
    return { error: "Too many reveals from this network recently. Please try again later." };
  }

  const [profile] = await db
    .select({ publicContactValue: users.publicContactValue })
    .from(users)
    .where(eq(users.id, profileUserId));

  if (!profile?.publicContactValue) {
    return { error: "No contact value on file for this profile." };
  }

  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const { env } = await getCloudflareContext({ async: true });
  const key = (env as unknown as SecretsEnv).PUBLIC_CONTACT_ENCRYPTION_KEY;

  const value = await decryptPublicContactValue(
    profile.publicContactValue as EncryptedEnvelope,
    key,
  );

  // Logged AFTER a successful decrypt — a reveal that failed (no value on
  // file) isn't a real reveal event.
  await db.insert(profileContactReveals).values({ profileUserId, ipHash, userAgent });

  return { value };
}
