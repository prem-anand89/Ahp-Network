"use client";

// Profile Card addendum — one tap to refresh availability, or freshness is
// theatre. Optimistic update with rollback on failure, same pattern as
// AddToCircleButton's checkbox toggles.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { setAvailabilityAction } from "@/app/actions/availability";

export function AvailabilityToggle({ initialCapacityState }: { initialCapacityState: "available" | "limited" | "not_taking" }) {
  const [capacity, setCapacity] = useState(initialCapacityState);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const next = capacity === "not_taking" ? "available" : "not_taking";
    setCapacity(next);
    setPending(true);
    setError(null);
    try {
      await setAvailabilityAction(next);
    } catch {
      setCapacity(capacity);
      setError("Couldn't update availability");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={handleClick}>
        {pending ? "Updating…" : capacity !== "not_taking" ? "Mark as not accepting new patients" : "Mark as accepting new patients"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
