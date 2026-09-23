"use client";

import { useState } from "react";
import { Bell, Mail } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { setNotificationPreferenceAction } from "./actions";
import type { ConfigurableEventType, NotificationChannel } from "@/lib/notification-preferences";
import { NOTIFICATION_SETTING_LABELS } from "@/lib/copy";

export interface PreferenceState {
  eventType: ConfigurableEventType;
  channel: NotificationChannel;
  enabled: boolean;
}

const CHANNEL_ICON: Record<NotificationChannel, typeof Bell> = { push: Bell, email: Mail };

// Same optimistic-with-rollback pattern as AvailabilityToggle.
function Row({ initial }: { initial: PreferenceState }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [pending, setPending] = useState(false);
  const Icon = CHANNEL_ICON[initial.channel];

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setPending(true);
    try {
      await setNotificationPreferenceAction(initial.eventType, initial.channel, next);
    } catch {
      setEnabled(!next);
    } finally {
      setPending(false);
    }
  }

  const id = `pref-${initial.eventType}-${initial.channel}`;
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-2.5">
      <label htmlFor={id} className="flex min-w-0 items-center gap-2.5 text-sm">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {NOTIFICATION_SETTING_LABELS.channel[initial.channel]}
      </label>
      <Switch id={id} checked={enabled} disabled={pending} onCheckedChange={toggle} />
    </div>
  );
}

export function NotificationPreferencesForm({
  eventTypes,
  initial,
}: {
  eventTypes: readonly ConfigurableEventType[];
  initial: PreferenceState[];
}) {
  function find(eventType: ConfigurableEventType, channel: NotificationChannel): PreferenceState {
    return initial.find((p) => p.eventType === eventType && p.channel === channel) ?? { eventType, channel, enabled: true };
  }

  return (
    <div className="flex flex-col gap-4">
      {eventTypes.map((eventType) => (
        // rounded-md border p-4 — same bordered-section convention as
        // every other /app/* page (dashboard, verification, circles),
        // not the Card component, which isn't the prevailing pattern here.
        <div key={eventType} className="rounded-md border p-4">
          <p className="mb-1 text-sm font-medium">{NOTIFICATION_SETTING_LABELS.eventType[eventType]}</p>
          <div className="flex flex-col divide-y divide-border">
            <Row initial={find(eventType, "push")} />
            <Row initial={find(eventType, "email")} />
          </div>
        </div>
      ))}
    </div>
  );
}
