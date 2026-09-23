"use server";

// Round 2 — the notification preferences settings screen's write path.

import { getDb } from "@/db/db";
import { requireAuthUserId } from "@/lib/require-session";
import { setPreference, type ConfigurableEventType, type NotificationChannel } from "@/lib/notification-preferences";

export async function setNotificationPreferenceAction(
  eventType: ConfigurableEventType,
  channel: NotificationChannel,
  enabled: boolean,
): Promise<void> {
  const userId = await requireAuthUserId();
  const db = await getDb();
  await setPreference(db, userId, eventType, channel, enabled);
}
