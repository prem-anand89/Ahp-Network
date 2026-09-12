"use client";

// Availability display with time-dependent freshness indicator. Both the stale
// calculation (computeAvailabilityDisplay using Date.now() to check staleness)
// and the "ago" formatting (timeAgoLabel using Date.now() for elapsed time) use
// the current time, causing hydration mismatches if computed server-side. Moving
// the entire logic to the client prevents React error #441.

import { computeAvailabilityDisplay } from "@/lib/availability";
import { timeAgoLabel } from "@/lib/referral-labels";

export function AvailabilityFreshness({
  availableForNewPatients,
  availabilityUpdatedAt,
}: {
  availableForNewPatients: boolean;
  availabilityUpdatedAt: Date | null;
}) {
  const availability = computeAvailabilityDisplay(availableForNewPatients, availabilityUpdatedAt);

  if (availability.kind === "not_stated") return null;

  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {availability.kind === "not_accepting"
        ? "Not accepting new patients right now"
        : "Available for new patients"}
      {" — updated "}
      {timeAgoLabel(availability.updatedAt)}
    </p>
  );
}
