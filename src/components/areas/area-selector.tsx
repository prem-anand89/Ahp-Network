"use client";

// The shared area selector — [v19] plan §6/BUILD_SEQUENCE.md Phase 2:
// "built once, here," consumed by home-visit areas, referral posting
// (Phase 6), and directory filters (Phase 5). Grouped tappable locality
// chips under their parent zone, zero network calls — the zone/locality
// tree is passed in as data (see src/lib/areas.ts), fetched once
// server-side, never re-fetched as the user taps around.
//
// Deliberately NOT a Google Places autocomplete — see plan §6 on why
// mismatched free-text/ID matching here would produce a silently empty
// referral matching pool, indistinguishable from a genuine density problem.

import { useState } from "react";
import type { AreaZone } from "@/lib/areas";

export interface AreaSelectorProps {
  zones: AreaZone[];
  /** Locality area ids. Multi-select — a therapist's home-visit coverage,
   * or a referral's single required area (pass max: 1 there). */
  value: string[];
  onChange: (localityIds: string[]) => void;
  max?: number;
}

export function AreaSelector({ zones, value, onChange, max }: AreaSelectorProps) {
  const [expandedZoneId, setExpandedZoneId] = useState<string | null>(zones[0]?.zone.id ?? null);

  function toggle(localityId: string) {
    if (value.includes(localityId)) {
      onChange(value.filter((id) => id !== localityId));
      return;
    }
    if (max !== undefined && value.length >= max) {
      // Single-select mode (max: 1) replaces rather than blocking — a
      // referral's area choice is one tap to change, not one tap to clear
      // then one to reselect.
      onChange(max === 1 ? [localityId] : value);
      return;
    }
    onChange([...value, localityId]);
  }

  return (
    <div className="space-y-3">
      {zones.map(({ zone, localities }) => {
        const expanded = expandedZoneId === zone.id;
        const selectedCount = localities.filter((l) => value.includes(l.id)).length;

        return (
          <div key={zone.id} className="rounded-md border">
            <button
              type="button"
              onClick={() => setExpandedZoneId(expanded ? null : zone.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
              aria-expanded={expanded}
            >
              <span>{zone.name}</span>
              <span className="text-xs text-muted-foreground">
                {selectedCount > 0 ? `${selectedCount} selected` : ""}
              </span>
            </button>
            {expanded && (
              <div className="flex flex-wrap gap-2 border-t px-4 py-3">
                {localities.map((locality) => {
                  const selected = value.includes(locality.id);
                  return (
                    <button
                      key={locality.id}
                      type="button"
                      onClick={() => toggle(locality.id)}
                      aria-pressed={selected}
                      className={
                        "rounded-full border px-3 py-1.5 text-sm transition-colors " +
                        (selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-accent")
                      }
                    >
                      {locality.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
