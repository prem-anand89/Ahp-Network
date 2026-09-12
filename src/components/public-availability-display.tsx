"use client";

import { computeAvailabilityDisplay } from "@/lib/availability";
import { timeAgoLabel } from "@/lib/referral-labels";

export function PublicAvailabilityDisplay({
  availableForNewPatients,
  availabilityUpdatedAt,
}: {
  availableForNewPatients: boolean;
  availabilityUpdatedAt: Date | null;
}) {
  const availability = computeAvailabilityDisplay(availableForNewPatients, availabilityUpdatedAt);
  if (availability.kind === "not_stated") return null;

  const label =
    availability.kind === "available_fresh" || availability.kind === "available_stale"
      ? "Available for new patients"
      : "Not accepting new patients right now";

  return (
    <div className="text-sm font-medium text-card-foreground">
      {label} — updated {timeAgoLabel(availability.updatedAt)}
    </div>
  );
}
