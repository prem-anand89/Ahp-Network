"use client";

// Step 5 [decision 11] — "my area isn't listed" fallback, next to
// AreaSelector wherever a therapist picks a locality (referral posting,
// home-visit area in onboarding/dashboard). Bounded to Hyderabad metro
// server-side (google-places.ts); a place outside it comes back as a
// thrown error, surfaced here rather than silently creating a bad row.

import { useState } from "react";
import { PlacesAutocomplete, type PlaceSelection } from "@/components/forms/places-autocomplete";
import { proposeAreaFromPlace, searchAreaPlaceSuggestions } from "@/app/app/areas/actions";
import { AREA_NOT_LISTED_PROMPT, AREA_SEARCH_PLACEHOLDER, areaPendingReviewNote } from "@/lib/copy";

export function AreaFallbackSearch({
  onAreaCreated,
}: {
  onAreaCreated: (area: { id: string; name: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);

  async function handleSelect(selection: PlaceSelection) {
    setError(null);
    setPending(true);
    try {
      const area = await proposeAreaFromPlace(selection.placeId, selection.text, selection.sessionToken);
      setCreated(area);
      onAreaCreated(area);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (created) {
    return (
      <p className="text-xs text-muted-foreground">
        {areaPendingReviewNote(created.name)}{" "}
        <button
          type="button"
          className="underline"
          onClick={() => {
            setCreated(null);
            setOpen(true);
          }}
        >
          Change
        </button>
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className="self-start text-xs text-muted-foreground hover:underline" onClick={() => setOpen(true)}>
        {AREA_NOT_LISTED_PROMPT}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <PlacesAutocomplete search={searchAreaPlaceSuggestions} onSelect={handleSelect} placeholder={AREA_SEARCH_PLACEHOLDER} />
      {pending && <p className="text-xs text-muted-foreground">Adding…</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
