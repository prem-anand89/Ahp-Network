// §8G4 (Phase 7) — sends a Web Push notification via VAPID + RFC 8291
// encryption, using @block65/webcrypto-web-push: a ~17KB library built
// specifically for Workers/Deno/Bun/Node via the standard WebCrypto API,
// unlike the `web-push` npm package (which uses Node's `crypto` module
// directly and does not run on Workers — the exact gap BUILD_SEQUENCE.md's
// [H7] flags, and why Phase 0.5's VAPID item was never proven until now).
//
// [H7]: this has NOT been exercised against a real device/browser
// subscription in this session — no live push endpoint was available to
// test against. The library itself is unit-tested and Workers-targeted by
// its authors; what's unverified here is the actual round trip against
// FCM/Apple's push infrastructure from a real deployed Worker. Run that
// before relying on this in production, same honesty standard as
// src/lib/ocr/vision.ts's own note.

import { buildPushPayload, type PushSubscription as WebPushSubscription, type VapidKeys } from "@block65/webcrypto-web-push";

export interface StoredPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushSendResult =
  | { outcome: "sent" }
  | { outcome: "stale" } // 404/410 — the subscription is gone, delete it
  | { outcome: "error"; status: number; body: string };

export async function sendPushNotification(
  subscription: StoredPushSubscription,
  message: { title: string; body: string; data?: Record<string, unknown> },
  vapid: VapidKeys,
): Promise<PushSendResult> {
  const webPushSubscription: WebPushSubscription = {
    endpoint: subscription.endpoint,
    expirationTime: null,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth },
  };

  const payload = await buildPushPayload(
    { data: JSON.stringify({ title: message.title, body: message.body, data: message.data }), options: { ttl: 60 * 60 } },
    webPushSubscription,
    vapid,
  );

  const res = await fetch(subscription.endpoint, payload);

  if (res.status === 404 || res.status === 410) {
    return { outcome: "stale" };
  }
  if (!res.ok) {
    return { outcome: "error", status: res.status, body: await res.text() };
  }
  return { outcome: "sent" };
}
