"use client";

// Round 3 step C — replaces area-selector.tsx for home-visit coverage.
// Validated against an interactive mockup before building (see the plan
// file's §2). Two grouped checklists per city — Primary (shown on the
// public profile) and Secondary (a private wider net, notified
// identically to Primary — see COVERAGE_SECONDARY_NOTE) — each a
// zone-accordion with a "Whole zone" tick over its localities. No
// "Anywhere in {city}" option: ticking every zone as secondary already
// is that, through the same mechanism at every scale. Up to
// MAX_COVERAGE_CITIES cities total, added via CityPicker.

import { useEffect, useState } from "react";
import { getCityAreaTreeAction } from "@/app/app/areas/actions";
import type { CityAreaTree } from "@/lib/area-search";
import { CityPicker, type CitySelection } from "@/components/areas/city-picker";
import {
  COVERAGE_PRIMARY_LABEL,
  COVERAGE_PRIMARY_SUB,
  COVERAGE_SECONDARY_LABEL,
  COVERAGE_SECONDARY_SUB,
  COVERAGE_SECONDARY_NOTE,
  COVERAGE_ADD_CITY_PROMPT,
  coverageMaxCitiesReached,
} from "@/lib/copy";
import { Button } from "@/components/ui/button";

export const MAX_COVERAGE_CITIES = 2;

export type CoverageTier = "primary" | "secondary";

export interface CoverageSelection {
  cityAreaId: string;
  areaId: string;
  tier: CoverageTier;
}

interface AreaCoveragePickerProps {
  /** The therapist's base city — always present, not removable here (it
   * follows the base locality picked in onboarding step 2). */
  primaryCity: CitySelection;
  /** The base locality's own id, used only to auto-expand its zone under
   * Primary on first render — never force-selected by this component. */
  baseAreaId?: string;
  value: CoverageSelection[];
  onChange: (value: CoverageSelection[]) => void;
  maxCities?: number;
}

export function AreaCoveragePicker({ primaryCity, baseAreaId, value, onChange, maxCities = MAX_COVERAGE_CITIES }: AreaCoveragePickerProps) {
  // Extra cities beyond primaryCity, inferred from whatever's already in
  // value (e.g. re-opening profile edit) plus any added this session.
  const [extraCities, setExtraCities] = useState<CitySelection[]>(() => {
    const ids = new Set(value.map((v) => v.cityAreaId).filter((id) => id !== primaryCity.id));
    return [...ids].map((id) => ({ id, name: "" }));
  });
  const [addingCity, setAddingCity] = useState(false);

  const cities = [primaryCity, ...extraCities];
  const atCap = cities.length >= maxCities;

  function applyAreaTier(base: CoverageSelection[], cityAreaId: string, areaId: string, tier: CoverageTier) {
    const already = base.find((v) => v.cityAreaId === cityAreaId && v.areaId === areaId);
    const rest = base.filter((v) => !(v.cityAreaId === cityAreaId && v.areaId === areaId));
    // Same tier tapped again — untick. Otherwise set/move to the new tier.
    onChange(already?.tier === tier ? rest : [...rest, { cityAreaId, areaId, tier }]);
  }

  function setAreaTier(cityAreaId: string, areaId: string, tier: CoverageTier) {
    applyAreaTier(value, cityAreaId, areaId, tier);
  }

  function collapseZone(cityAreaId: string, zoneId: string, localityIds: string[], tier: CoverageTier) {
    // Ticking a whole zone: store the zone row and drop any of its own
    // localities from the same tier, so a zone + its own locality never
    // both persist ("redundant ticks collapse" per the plan).
    const withoutLocalities = value.filter(
      (v) => !(v.cityAreaId === cityAreaId && v.tier === tier && localityIds.includes(v.areaId)),
    );
    applyAreaTier(withoutLocalities, cityAreaId, zoneId, tier);
  }

  function removeCity(cityAreaId: string) {
    setExtraCities((prev) => prev.filter((c) => c.id !== cityAreaId));
    onChange(value.filter((v) => v.cityAreaId !== cityAreaId));
  }

  function addCity(city: CitySelection) {
    setExtraCities((prev) => (prev.some((c) => c.id === city.id) ? prev : [...prev, city]));
    setAddingCity(false);
  }

  return (
    <div className="flex flex-col gap-6">
      {cities.map((city) => (
        <CityCoverageBlock
          key={city.id}
          city={city}
          baseAreaId={city.id === primaryCity.id ? baseAreaId : undefined}
          value={value.filter((v) => v.cityAreaId === city.id)}
          onSetTier={(areaId, tier) => setAreaTier(city.id, areaId, tier)}
          onCollapseZone={(zoneId, localityIds, tier) => collapseZone(city.id, zoneId, localityIds, tier)}
          onRemoveCity={city.id === primaryCity.id ? undefined : () => removeCity(city.id)}
        />
      ))}

      {!addingCity ? (
        atCap ? (
          <p className="text-xs text-muted-foreground">{coverageMaxCitiesReached(maxCities)}</p>
        ) : (
          <Button type="button" variant="link" size="sm" className="self-start px-0" onClick={() => setAddingCity(true)}>
            {COVERAGE_ADD_CITY_PROMPT}
          </Button>
        )
      ) : (
        <div className="rounded-md border p-3">
          <CityPicker
            onSelect={(city) => addCity(city)}
            autoFocus
          />
          <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setAddingCity(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function CityCoverageBlock({
  city,
  baseAreaId,
  value,
  onSetTier,
  onCollapseZone,
  onRemoveCity,
}: {
  city: CitySelection;
  baseAreaId?: string;
  value: CoverageSelection[];
  onSetTier: (areaId: string, tier: CoverageTier) => void;
  onCollapseZone: (zoneId: string, localityIds: string[], tier: CoverageTier) => void;
  onRemoveCity?: () => void;
}) {
  const [tree, setTree] = useState<CityAreaTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedZoneId, setExpandedZoneId] = useState<string | null>(null);

  useEffect(() => {
    // `key={city.id}` on this component in the parent's map means a
    // changed city remounts it rather than re-running this effect in
    // place, so `loading`'s useState(true) initializer already covers
    // the "just switched city" case — no synchronous setLoading(true)
    // needed here.
    let cancelled = false;
    getCityAreaTreeAction(city.id)
      .then((t) => {
        if (cancelled) return;
        setTree(t);
        const baseZone = baseAreaId ? t.zones.find((z) => z.localities.some((l) => l.id === baseAreaId)) : undefined;
        setExpandedZoneId(baseZone?.id ?? t.zones[0]?.id ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [city.id, baseAreaId]);

  const tierOf = (areaId: string) => value.find((v) => v.areaId === areaId)?.tier;

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{city.name || tree?.cityName || "…"}</h3>
        {onRemoveCity && (
          <Button type="button" variant="ghost" size="sm" onClick={onRemoveCity}>
            Remove
          </Button>
        )}
      </div>

      {loading || !tree ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <>
          <CoverageTierGroup
            label={COVERAGE_PRIMARY_LABEL}
            sub={COVERAGE_PRIMARY_SUB}
            tier="primary"
            tree={tree}
            tierOf={tierOf}
            expandedZoneId={expandedZoneId}
            onExpandZone={setExpandedZoneId}
            onSetTier={onSetTier}
            onCollapseZone={onCollapseZone}
          />
          <CoverageTierGroup
            label={COVERAGE_SECONDARY_LABEL}
            sub={COVERAGE_SECONDARY_SUB}
            tier="secondary"
            tree={tree}
            tierOf={tierOf}
            expandedZoneId={expandedZoneId}
            onExpandZone={setExpandedZoneId}
            onSetTier={onSetTier}
            onCollapseZone={onCollapseZone}
          />
          <p className="text-xs text-muted-foreground">{COVERAGE_SECONDARY_NOTE}</p>
        </>
      )}
    </div>
  );
}

function CoverageTierGroup({
  label,
  sub,
  tier,
  tree,
  tierOf,
  expandedZoneId,
  onExpandZone,
  onSetTier,
  onCollapseZone,
}: {
  label: string;
  sub: string;
  tier: CoverageTier;
  tree: CityAreaTree;
  tierOf: (areaId: string) => CoverageTier | undefined;
  expandedZoneId: string | null;
  onExpandZone: (zoneId: string | null) => void;
  onSetTier: (areaId: string, tier: CoverageTier) => void;
  onCollapseZone: (zoneId: string, localityIds: string[], tier: CoverageTier) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <p className="text-xs font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
      <div className="space-y-2">
        {tree.zones.map((zone) => {
          const expanded = expandedZoneId === zone.id;
          const zoneTier = tierOf(zone.id);
          const localityIds = zone.localities.map((l) => l.id);
          const selectedCount = zone.localities.filter((l) => tierOf(l.id) === tier).length;

          return (
            <div key={zone.id} className="rounded-md border">
              <div className="flex items-center justify-between px-3 py-2">
                <button
                  type="button"
                  onClick={() => onExpandZone(expanded ? null : zone.id)}
                  className="text-left text-sm font-medium"
                  aria-expanded={expanded}
                >
                  {zone.name}
                  {selectedCount > 0 && zoneTier !== tier && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">({selectedCount} selected)</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onCollapseZone(zone.id, localityIds, tier)}
                  aria-pressed={zoneTier === tier}
                  className={
                    "rounded-full border px-3 py-1 text-xs transition-colors " +
                    (zoneTier === tier ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")
                  }
                >
                  Whole zone
                </button>
              </div>
              {expanded && zoneTier !== tier && (
                <div className="flex flex-wrap gap-2 border-t px-3 py-2.5">
                  {zone.localities.map((locality) => {
                    const selected = tierOf(locality.id) === tier;
                    return (
                      <button
                        key={locality.id}
                        type="button"
                        onClick={() => onSetTier(locality.id, tier)}
                        aria-pressed={selected}
                        className={
                          "rounded-full border px-3 py-1.5 text-sm transition-colors " +
                          (selected ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")
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
        {tree.unzoned.length > 0 && (
          <div className="flex flex-wrap gap-2 rounded-md border px-3 py-2.5">
            {tree.unzoned.map((locality) => {
              const selected = tierOf(locality.id) === tier;
              return (
                <button
                  key={locality.id}
                  type="button"
                  onClick={() => onSetTier(locality.id, tier)}
                  aria-pressed={selected}
                  className={
                    "rounded-full border px-3 py-1.5 text-sm transition-colors " +
                    (selected ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")
                  }
                >
                  {locality.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
