"use client";

// Profile Card addendum — one tap to refresh availability, or freshness is
// theatre. Optimistic update with rollback on failure, same pattern as
// AddToCircleButton's checkbox toggles.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { setAvailabilityAction } from "@/app/actions/availability";

export function AvailabilityToggle({ initialAvailable }: { initialAvailable: boolean }) {
  const [available, setAvailable] = useState(initialAvailable);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const next = !available;
    setAvailable(next);
    setPending(true);
    setError(null);
    try {
      await setAvailabilityAction(next);
    } catch {
      setAvailable(!next);
      setError("Couldn't update availability");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={handleClick}>
        {pending ? "Updating…" : available ? "Mark as not accepting new patients" : "Mark as accepting new patients"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
