// Runs against a real local Postgres, never mocks — except the actual
// push-service HTTP call and VAPID crypto, which are stubbed here since
// this test cares about [H1]'s parallel-send *decision*, not the push
// wire protocol itself (that's web-push.ts's own concern, and per its own
// honesty note, unverified against a live push endpoint in this session).

import { afterEach, afterAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { createReferralNotificationSender } from "./referral-notification-sender";
import * as webPush from "./web-push";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdReferralIds: string[] = [];

afterEach(async () => {
  let referralId: string | undefined;
  while ((referralId = createdReferralIds.pop()) !== undefined) {
    await client`DELETE FROM home_case_referrals WHERE id = ${referralId}`;
  }
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createUser(email: string): Promise<string> {
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

async function createReferral(urgency: "routine" | "urgent"): Promise<string> {
  const poster = await createUser(`poster-${crypto.randomUUID()}@test.local`);
  const [ref] = await client`
    INSERT INTO home_case_referrals (posted_by_user_id, posted_by_type, role_needed, specialization_needed, home_visit_required, urgency)
    VALUES (${poster}, 'therapist', 'physiotherapist', 'musculoskeletal_orthopaedic', true, ${urgency})
    RETURNING id`;
  createdReferralIds.push(ref.id);
  return ref.id;
}

const vapid = { subject: "mailto:test@example.com", publicKey: "test", privateKey: "test" };

describe("createReferralNotificationSender — [H1] parallel email for urgent offers", () => {
  it("sends email for an urgent referral_offered notification, with no push subscription registered", async () => {
    const referralId = await createReferral("urgent");
    const therapist = await createUser(`therapist-${crypto.randomUUID()}@test.local`);
    const sendEmail = vi.fn().mockResolvedValue(true);
    const sender = createReferralNotificationSender({ db, vapid, sendEmail });

    const result = await sender({
      id: crypto.randomUUID(),
      userId: therapist,
      channel: "push",
      template: "referral_offered",
      payload: { referral_id: referralId },
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it("does not send email for a routine referral_offered notification", async () => {
    const referralId = await createReferral("routine");
    const therapist = await createUser(`therapist-${crypto.randomUUID()}@test.local`);
    const sendEmail = vi.fn().mockResolvedValue(true);
    const sender = createReferralNotificationSender({ db, vapid, sendEmail });

    await sender({
      id: crypto.randomUUID(),
      userId: therapist,
      channel: "push",
      template: "referral_offered",
      payload: { referral_id: referralId },
    });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("still fires email for an urgent offer even when push delivery also succeeds (parallel, not fallback)", async () => {
    const referralId = await createReferral("urgent");
    const therapist = await createUser(`therapist-${crypto.randomUUID()}@test.local`);
    await client`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (${therapist}, ${"https://example.com/push/" + crypto.randomUUID()}, 'p', 'a')`;

    vi.spyOn(webPush, "sendPushNotification").mockResolvedValue({ outcome: "sent" });
    const sendEmail = vi.fn().mockResolvedValue(true);
    const sender = createReferralNotificationSender({ db, vapid, sendEmail });

    await sender({
      id: crypto.randomUUID(),
      userId: therapist,
      channel: "push",
      template: "referral_offered",
      payload: { referral_id: referralId },
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);

    await client`DELETE FROM push_subscriptions WHERE user_id = ${therapist}`;
    vi.restoreAllMocks();
  });
});
