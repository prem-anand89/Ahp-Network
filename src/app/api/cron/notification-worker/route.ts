// Phase 7 — the real notification_outbox sender, now that a real sender
// exists (Phase 6 deliberately left this route out entirely to avoid
// marking real notifications 'sent' without delivering them). Fires more
// often than the referral deadline scheduler (2 minutes vs. 15) since an
// offer notification arriving late eats directly into the receiving
// therapist's 2-hour (or, for urgent, 2-working-hour) accept window.

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/db";
import { processOutboxOnce } from "@/lib/notification-outbox-worker";
import { createReferralNotificationSender } from "@/lib/referral-notification-sender";
import { sendEmailViaResend } from "@/lib/email";

export const dynamic = "force-dynamic";

interface WorkerEnv {
  CRON_SECRET?: string;
  VAPID_SUBJECT?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM_ADDRESS?: string;
}

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const secrets = env as unknown as WorkerEnv;

  if (!secrets.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${secrets.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!secrets.VAPID_PUBLIC_KEY || !secrets.VAPID_PRIVATE_KEY || !secrets.VAPID_SUBJECT) {
    return NextResponse.json({ error: "VAPID secrets not configured" }, { status: 500 });
  }

  const db = await getDb();
  const sender = createReferralNotificationSender({
    db,
    vapid: {
      subject: secrets.VAPID_SUBJECT,
      publicKey: secrets.VAPID_PUBLIC_KEY,
      privateKey: secrets.VAPID_PRIVATE_KEY,
    },
    sendEmail: async (to, subject, body) => {
      if (!secrets.RESEND_API_KEY || !secrets.EMAIL_FROM_ADDRESS) return false;
      return sendEmailViaResend({ RESEND_API_KEY: secrets.RESEND_API_KEY, EMAIL_FROM_ADDRESS: secrets.EMAIL_FROM_ADDRESS }, to, subject, body);
    },
  });

  const result = await processOutboxOnce(db, sender);
  return NextResponse.json(result);
}
