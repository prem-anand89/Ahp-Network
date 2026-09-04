import { afterAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  needsReauthentication,
  computeContactDisclosureHoldExpiry,
  isWithinContactDisclosureHold,
  recordSensitiveIdentityChange,
} from "./sensitive-identity-change";

describe("needsReauthentication (§4 — 15-minute freshness)", () => {
  it("does not require re-auth for a session authenticated 5 minutes ago", () => {
    const now = new Date("2026-01-01T12:15:00Z");
    const lastAuth = new Date("2026-01-01T12:10:00Z");
    expect(needsReauthentication(lastAuth, now)).toBe(false);
  });

  it("requires re-auth for a session authenticated 16 minutes ago", () => {
    const now = new Date("2026-01-01T12:16:00Z");
    const lastAuth = new Date("2026-01-01T12:00:00Z");
    expect(needsReauthentication(lastAuth, now)).toBe(true);
  });

  it("is exactly on the boundary at 15 minutes — not yet expired", () => {
    const lastAuth = new Date("2026-01-01T12:00:00Z");
    const now = new Date("2026-01-01T12:15:00Z");
    expect(needsReauthentication(lastAuth, now)).toBe(false);
  });
});

describe("contact disclosure hold (§4 — 48 hours)", () => {
  it("computes an expiry exactly 48 hours out", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const expiry = computeContactDisclosureHoldExpiry(now);
    expect(expiry.toISOString()).toBe("2026-01-03T00:00:00.000Z");
  });

  it("is within the hold before expiry, not within it after", () => {
    const holdUntil = new Date("2026-01-03T00:00:00Z");
    expect(isWithinContactDisclosureHold(holdUntil, new Date("2026-01-02T00:00:00Z"))).toBe(true);
    expect(isWithinContactDisclosureHold(holdUntil, new Date("2026-01-04T00:00:00Z"))).toBe(false);
  });

  it("null hold is never active", () => {
    expect(isWithinContactDisclosureHold(null)).toBe(false);
  });
});

describe("recordSensitiveIdentityChange — real Postgres", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
  const client = postgres(connectionString, { prepare: false, max: 2 });
  const db = drizzle(client, { schema });
  const testId = "22222222-2222-2222-2222-222222222222";

  afterAll(async () => {
    await db.delete(schema.notificationOutbox).where(eq(schema.notificationOutbox.userId, testId));
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.actorUserId, testId));
    await db.delete(schema.users).where(eq(schema.users.id, testId));
    await client`DELETE FROM auth.users WHERE id = ${testId}`;
    await client.end();
  });

  it("sets the 48-hour hold and writes an audit log entry with PII redacted", async () => {
    await client`INSERT INTO auth.users (id, email) VALUES (${testId}, 'sensitive-test@example.com')`;
    await db.insert(schema.users).values({
      id: testId,
      email: "sensitive-test@example.com",
      accountType: "therapist",
    });

    await recordSensitiveIdentityChange(db, {
      userId: testId,
      field: "email",
      oldValue: "old@example.com",
      newValue: "sensitive-test@example.com",
      ipAddress: "203.0.113.1",
    });

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, testId));
    expect(user.contactDisclosureHoldUntil).not.toBeNull();
    expect(user.contactDisclosureHoldUntil!.getTime()).toBeGreaterThan(Date.now());

    const [log] = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.actorUserId, testId));
    expect(log.action).toBe("sensitive_identity_change");
    expect(log.beforeState).toEqual({ field: "email", changed: true });
    expect(log.afterState).toEqual({ field: "email", changed: true });
    // The actual email values must never appear in the audit row (§5).
    expect(JSON.stringify(log.beforeState)).not.toContain("old@example.com");
    expect(JSON.stringify(log.afterState)).not.toContain("sensitive-test@example.com");

    const [notification] = await db
      .select()
      .from(schema.notificationOutbox)
      .where(eq(schema.notificationOutbox.userId, testId));
    expect(notification.channel).toBe("email");
    expect(notification.template).toBe("identity_change_alert");
    expect(notification.payload).toEqual({ field: "email" });
    // Same redaction discipline as the audit row — no raw address in the payload.
    expect(JSON.stringify(notification.payload)).not.toContain("old@example.com");
    expect(JSON.stringify(notification.payload)).not.toContain("sensitive-test@example.com");
  });
});
