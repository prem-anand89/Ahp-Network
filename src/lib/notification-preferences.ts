// Round 2 — reads notification_preferences (schema.ts). Absence of a row
// means enabled; a row only ever exists to record an explicit disable
// choice made through settings. See referral-notification-sender.ts for
// the one caller and the hardcoded exception for urgent referral_offered.

import { and, eq } from "drizzle-orm";
import { notificationPreferences } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

export type NotificationChannel = "push" | "email";

/**
 * True unless the user has an explicit disabled row for this exact
 * (event_type, channel) pair.
 */
export async function isChannelEnabled(
  db: Db,
  userId: string,
  eventType: string,
  channel: NotificationChannel,
): Promise<boolean> {
  const [row] = await db
    .select({ enabled: notificationPreferences.enabled })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.eventType, eventType),
        eq(notificationPreferences.channel, channel),
      ),
    );
  return row?.enabled ?? true;
}

export interface NotificationPreferenceRow {
  eventType: string;
  channel: NotificationChannel;
  enabled: boolean;
}

/** Every explicit preference a user has set, for a settings screen. */
export async function listPreferences(db: Db, userId: string): Promise<NotificationPreferenceRow[]> {
  const rows = await db
    .select({
      eventType: notificationPreferences.eventType,
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  return rows.map((r) => ({ ...r, channel: r.channel as NotificationChannel }));
}

/**
 * The event types a settings screen should ever expose a toggle for.
 * Deliberately excludes referral_offered — [H1] requires urgent offers
 * to always send push AND email, so there is nothing to toggle for it.
 * Kept as a single source of truth so the settings UI and the sender
 * can't drift on what's actually configurable.
 */
export const CONFIGURABLE_EVENT_TYPES = ["referral_posted_match", "weekly_digest"] as const;

export type ConfigurableEventType = (typeof CONFIGURABLE_EVENT_TYPES)[number];

export async function setPreference(
  db: Db,
  userId: string,
  eventType: ConfigurableEventType,
  channel: NotificationChannel,
  enabled: boolean,
): Promise<void> {
  await db
    .insert(notificationPreferences)
    .values({ userId, eventType, channel, enabled, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.eventType, notificationPreferences.channel],
      set: { enabled, updatedAt: new Date() },
    });
}
