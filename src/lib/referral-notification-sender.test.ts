// The gating tests below run against a real local Postgres (same
// convention as notification-outbox-worker.test.ts) since they exercise
// notification_preferences and quiet-hours logic that reads real user/
// preference rows. No push subscription rows are ever inserted here, so
// sendPushNotification is never actually invoked — the VAPID keys below
// are placeholders that are structurally valid but never dereferenced.

import { afterEach, afterAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { buildNotificationMessage, createReferralNotificationSender } from "./referral-notification-sender";

describe("buildNotificationMessage — §8G4", () => {
  it("has a human-readable message for every template the three referral functions enqueue", () => {
    const templates = [
      "referral_posted_match",
      "referral_offered",
      "referral_accepted",
      "referral_went_to_someone_else",
      "referral_missed_choose_again",
      "identity_change_alert",
    ];
    for (const template of templates) {
      const message = buildNotificationMessage(template);
      expect(message.title.length).toBeGreaterThan(0);
      expect(message.body.length).toBeGreaterThan(0);
    }
  });

  it("falls back to a generic message for an unrecognized template rather than throwing", () => {
    expect(() => buildNotificationMessage("something_new")).not.toThrow();
  });

  it("includes the presigned link in the data_export_ready body (§8H)", () => {
    const message = buildNotificationMessage("data_export_ready", { url: "https://example.com/download" });
    expect(message.body).toContain("https://example.com/download");
  });
});

const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const FAKE_VAPID = { subject: "mailto:test@example.com", publicKey: "test-public", privateKey: "test-private" };

const createdUserIds: string[] = [];

afterEach(async () => {
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM notification_preferences WHERE user_id = ${userId}`;
    await client`DELETE FROM home_case_referrals WHERE posted_by_user_id = ${userId}`;
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createUser(): Promise<string> {
  const email = `sender-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("createReferralNotificationSender — Round 2 gating", () => {
  it("skips a channel the user has explicitly disabled, and doesn't treat that as a failure", async () => {
    const userId = await createUser();
    await client`
      INSERT INTO notification_preferences (user_id, event_type, channel, enabled)
      VALUES (${userId}, 'referral_posted_match', 'push', false)
    `;

    const sendEmail = vi.fn().mockResolvedValue(true);
    const sender = createReferralNotificationSender({ db, vapid: FAKE_VAPID, sendEmail });

    const result = await sender({
      id: crypto.randomUUID(),
      userId,
      channel: "push",
      template: "referral_posted_match",
      payload: {},
    });

    expect(result).toEqual({ ok: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("still sends when the user has no preference row (absence = enabled)", async () => {
    const userId = await createUser();
    // Force outside quiet hours so this isn't also exercising the defer path.
    vi.setSystemTime(new Date("2026-01-01T08:30:00Z")); // 2PM IST

    const sendEmail = vi.fn().mockResolvedValue(true);
    const sender = createReferralNotificationSender({ db, vapid: FAKE_VAPID, sendEmail });

    const result = await sender({
      id: crypto.randomUUID(),
      userId,
      channel: "push",
      template: "referral_posted_match",
      payload: {},
    });

    vi.useRealTimers();
    // No push subscriptions and no email fired on this channel — nothing
    // to deliver to, which the sender treats as ok, not a failure.
    expect(result).toEqual({ ok: true });
  });

  it("defers a routine push queued during quiet hours (10PM-7AM IST) rather than sending or failing", async () => {
    const userId = await createUser();
    vi.setSystemTime(new Date("2026-01-01T17:30:00Z")); // 11PM IST

    const sendEmail = vi.fn().mockResolvedValue(true);
    const sender = createReferralNotificationSender({ db, vapid: FAKE_VAPID, sendEmail });

    const result = await sender({
      id: crypto.randomUUID(),
      userId,
      channel: "push",
      template: "referral_posted_match",
      payload: {},
    });

    vi.useRealTimers();
    expect(result.ok).toBe("deferred");
    if (result.ok === "deferred") {
      expect(result.until.getTime()).toBeGreaterThan(Date.parse("2026-01-01T17:30:00Z"));
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("never defers or gates an urgent referral_offered, even during quiet hours", async () => {
    const userId = await createUser();
    vi.setSystemTime(new Date("2026-01-01T17:30:00Z")); // 11PM IST

    const [referral] = await client`
      INSERT INTO home_case_referrals
        (posted_by_user_id, posted_by_type, role_needed, specialization_needed, home_visit_required, urgency, patient_consent_recorded_at)
      VALUES (${userId}, 'therapist', 'physiotherapist', 'musculoskeletal_orthopaedic', true, 'urgent', now())
      RETURNING id
    `;

    const sendEmail = vi.fn().mockResolvedValue(true);
    const sender = createReferralNotificationSender({ db, vapid: FAKE_VAPID, sendEmail });

    const result = await sender({
      id: crypto.randomUUID(),
      userId,
      channel: "push",
      template: "referral_offered",
      payload: { referral_id: referral.id },
    });

    vi.useRealTimers();
    // Not deferred (bypasses quiet hours) and [H1]'s parallel email fired.
    expect(result.ok).not.toBe("deferred");
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  // Review item #4 — referral_first_look_direct is always-on (never in
  // CONFIGURABLE_EVENT_TYPES, so no preference row can silence it) and
  // gets [H1]'s parallel email, same as an urgent offer — but unlike an
  // urgent offer it's still deferred during quiet hours, since a "Refer
  // Patient" case isn't the 2-hour patient-harm-risk window urgent is.
  it("referral_first_look_direct always sends (ignores any preference row) with parallel email", async () => {
    const userId = await createUser();
    // Even an explicit disable row can't silence it — it isn't
    // configurable, so the sender never consults notification_preferences
    // for this template at all.
    await client`
      INSERT INTO notification_preferences (user_id, event_type, channel, enabled)
      VALUES (${userId}, 'referral_first_look_direct', 'push', false)`;

    const sendEmail = vi.fn().mockResolvedValue(true);
    const sender = createReferralNotificationSender({ db, vapid: FAKE_VAPID, sendEmail });

    const result = await sender({
      id: crypto.randomUUID(),
      userId,
      channel: "push",
      template: "referral_first_look_direct",
      payload: { referral_id: crypto.randomUUID() },
    });

    expect(result.ok).not.toBe("deferred");
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("referral_first_look_direct is still deferred during quiet hours — it isn't urgent", async () => {
    const userId = await createUser();
    vi.setSystemTime(new Date("2026-01-01T17:30:00Z")); // 11PM IST

    const sendEmail = vi.fn().mockResolvedValue(true);
    const sender = createReferralNotificationSender({ db, vapid: FAKE_VAPID, sendEmail });

    const result = await sender({
      id: crypto.randomUUID(),
      userId,
      channel: "push",
      template: "referral_first_look_direct",
      payload: { referral_id: crypto.randomUUID() },
    });

    vi.useRealTimers();
    expect(result.ok).toBe("deferred");
  });
});
