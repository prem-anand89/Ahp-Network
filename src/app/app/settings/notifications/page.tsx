// Round 2 — the app's first settings page. Currently one section
// (notification channel preferences); more settings can land as
// siblings under /app/settings without this page needing to change.

import { getDb } from "@/db/db";
import { requireAuthUserId } from "@/lib/require-session";
import { CONFIGURABLE_EVENT_TYPES, listPreferences, type ConfigurableEventType } from "@/lib/notification-preferences";
import { NOTIFICATION_SETTING_LABELS } from "@/lib/copy";
import { NotificationPreferencesForm } from "./notification-preferences-form";

export const dynamic = "force-dynamic";

function isConfigurable(eventType: string): eventType is ConfigurableEventType {
  return (CONFIGURABLE_EVENT_TYPES as readonly string[]).includes(eventType);
}

export default async function NotificationSettingsPage() {
  const userId = await requireAuthUserId();
  const db = await getDb();
  const rows = await listPreferences(db, userId);
  // The table can in principle hold a row for an event_type this page no
  // longer configures (e.g. one removed from CONFIGURABLE_EVENT_TYPES
  // after being shipped) — filter rather than trust every stored row.
  const preferences = rows.filter((r) => isConfigurable(r.eventType)).map((r) => ({ ...r, eventType: r.eventType as ConfigurableEventType }));

  return (
    <main className="mx-auto max-w-lg space-y-6 p-6">
      <h1 className="text-xl font-semibold">{NOTIFICATION_SETTING_LABELS.pageTitle}</h1>
      <p className="text-sm text-muted-foreground">{NOTIFICATION_SETTING_LABELS.pageIntro}</p>

      <NotificationPreferencesForm eventTypes={CONFIGURABLE_EVENT_TYPES} initial={preferences} />

      <p className="text-xs text-muted-foreground">{NOTIFICATION_SETTING_LABELS.alwaysOnNote}</p>
    </main>
  );
}
