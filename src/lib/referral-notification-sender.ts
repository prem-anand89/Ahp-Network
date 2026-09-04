// §8G4/[H1] (Phase 7) — the real `send` function notification-outbox-
// worker.ts was deliberately left pluggable for. Wires push (via
// web-push.ts) to every subscribed device, deletes a subscription the
// push service reports gone (404/410), and — [H1] — for an urgent
// referral's offer notification, ALSO sends email IN PARALLEL with push,
// never as a fallback after push fails. On iOS, web push silently
// delivers nothing unless the user has installed the PWA to their home
// screen — there is no failure event to fall back from, so "try push,
// email if it fails" would silently drop every urgent offer to an iOS
// Safari user. §8D's 2-hour urgent window depends on the message actually
// arriving somewhere.

import { eq } from "drizzle-orm";
import { homeCaseReferrals, pushSubscriptions, users } from "@/db/schema";
import { sendPushNotification, type StoredPushSubscription } from "@/lib/web-push";
import type { NotificationSendResult, NotificationSender } from "@/lib/notification-outbox-worker";
import type { getDb } from "@/db/db";
import type { VapidKeys } from "./vendor/webcrypto-web-push/vapid.js";

type Db = Awaited<ReturnType<typeof getDb>>;

export type SendEmailFn = (to: string, subject: string, body: string) => Promise<boolean>;

/** Pure — testable independent of any network call. */
export function buildNotificationMessage(template: string): { title: string; body: string } {
  switch (template) {
    case "referral_posted_match":
      return { title: "New referral near you", body: "A referral matching your profile was just posted." };
    case "referral_offered":
      return { title: "You've been offered a referral", body: "Open the app to accept before the window closes." };
    case "referral_accepted":
      return { title: "Your referral was accepted", body: "Share the patient's details with the accepting therapist." };
    case "referral_went_to_someone_else":
      return { title: "Referral update", body: "Someone else accepted this one first." };
    case "referral_missed_choose_again":
      return { title: "Choose someone else", body: "Your offer window closed unanswered — pick another therapist." };
    case "identity_change_alert":
      return {
        title: "Your account details changed",
        body: "Your email, phone, or name was just changed. If this wasn't you, contact support immediately.",
      };
    default:
      return { title: "AHP Network", body: "You have a new update." };
  }
}

export interface CreateSenderOptions {
  db: Db;
  vapid: VapidKeys;
  sendEmail: SendEmailFn;
}

export function createReferralNotificationSender({ db, vapid, sendEmail }: CreateSenderOptions): NotificationSender {
  return async (row): Promise<NotificationSendResult> => {
    const message = buildNotificationMessage(row.template);

    // [H1] — urgent offers get email in parallel, unconditionally, not as
    // a push-failure fallback. Separately, any row explicitly enqueued on
    // the 'email' channel (e.g. §4's identity_change_alert) always sends
    // by email to whatever address is currently on file — there's no push
    // fallback for a channel that was never push to begin with.
    let emailFired: Promise<boolean> | null = null;
    if (row.template === "referral_offered") {
      const payload = row.payload as { referral_id?: string };
      if (payload.referral_id) {
        const [referral] = await db
          .select({ urgency: homeCaseReferrals.urgency })
          .from(homeCaseReferrals)
          .where(eq(homeCaseReferrals.id, payload.referral_id));
        if (referral?.urgency === "urgent") {
          const [recipient] = await db.select({ email: users.email }).from(users).where(eq(users.id, row.userId));
          if (recipient) {
            emailFired = sendEmail(recipient.email, message.title, message.body);
          }
        }
      }
    } else if (row.channel === "email") {
      const [recipient] = await db.select({ email: users.email }).from(users).where(eq(users.id, row.userId));
      if (recipient) {
        emailFired = sendEmail(recipient.email, message.title, message.body);
      }
    }

    const subscriptions = await db
      .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, row.userId));

    let pushSent = false;
    for (const sub of subscriptions) {
      const stored: StoredPushSubscription = { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth };
      const result = await sendPushNotification(stored, { title: message.title, body: message.body, data: row.payload as Record<string, unknown> }, vapid);
      if (result.outcome === "sent") {
        pushSent = true;
        await db.update(pushSubscriptions).set({ lastSeenAt: new Date() }).where(eq(pushSubscriptions.id, sub.id));
      } else if (result.outcome === "stale") {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      }
    }

    const emailSent = emailFired ? await emailFired : false;

    if (pushSent || emailSent) return { ok: true };
    // No working subscription and (not urgent, or email failed) — a
    // non-urgent notification with no device to reach genuinely has
    // nothing to deliver to; that's not a transient failure to retry.
    if (subscriptions.length === 0 && !emailFired) return { ok: true };
    return { ok: false, error: "no channel delivered the notification" };
  };
}
