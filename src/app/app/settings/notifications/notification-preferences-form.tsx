"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { setNotificationPreferenceAction } from "./actions";
import type { ConfigurableEventType, NotificationChannel } from "@/lib/notification-preferences";
import { NOTIFICATION_SETTING_LABELS } from "@/lib/copy";

export interface PreferenceState {
  eventType: ConfigurableEventType;
  channel: NotificationChannel;
  enabled: boolean;
}

// Same optimistic-with-rollback pattern as AvailabilityToggle.
function Row({ initial }: { initial: PreferenceState }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [pending, setPending] = useState(false);

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
    <Label htmlFor={id} className="flex min-h-11 items-center gap-3 font-normal">
      <Checkbox id={id} checked={enabled} disabled={pending} onCheckedChange={toggle} />
      {NOTIFICATION_SETTING_LABELS.channel[initial.channel]}
    </Label>
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
    <div className="flex flex-col gap-6">
      {eventTypes.map((eventType) => (
        <div key={eventType} className="flex flex-col gap-2">
          <p className="text-sm font-medium">{NOTIFICATION_SETTING_LABELS.eventType[eventType]}</p>
          <div className="flex flex-col gap-1">
            <Row initial={find(eventType, "push")} />
            <Row initial={find(eventType, "email")} />
          </div>
        </div>
      ))}
    </div>
  );
}
