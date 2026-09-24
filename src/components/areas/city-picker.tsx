"use client";

// Round 3 step C — real-time city search, validated against an
// interactive mockup before building: nothing listed until typing
// starts, filtered on every keystroke, no debounce (it's our own
// indexed table, not a paid external API — see area-search.ts). A bare
// 6-digit PIN resolves through the localities that carry it, since city
// rows themselves have no PIN of their own.
//
// Search fires from the input's own onChange, not a useEffect keyed on
// query — same pattern as places-autocomplete.tsx (minus its debounce,
// unneeded here). A ref-held request counter, not an effect-cleanup
// closure, is what discards a stale response if a later keystroke's
// request resolves first.

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { searchAreasAction } from "@/app/app/areas/actions";
import { AREA_SEARCH_EMPTY_HINT, AREA_SEARCH_NO_MATCH, CITY_SEARCH_HINT, CITY_SEARCH_PLACEHOLDER, areaSearchCountHint } from "@/lib/copy";

const PIN_PATTERN = /^\d{1,6}$/;
const RESULT_CAP = 6;

export interface CitySelection {
  id: string;
  name: string;
}

interface CityResult {
  id: string;
  name: string;
  label: string;
  viaLocality?: string;
}

export function CityPicker({ onSelect, autoFocus = false }: { onSelect: (city: CitySelection) => void; autoFocus?: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CityResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  async function runSearch(value: string) {
    const trimmed = value.trim();
    if (trimmed.length < 1) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const isPin = PIN_PATTERN.test(trimmed);
    try {
      const rows = isPin
        ? await searchAreasAction(trimmed, { levels: ["locality"] })
        : await searchAreasAction(trimmed, { levels: ["city"] });
      if (requestId !== requestIdRef.current) return;
      if (isPin) {
        // A PIN belongs to a locality; resolve to its city, deduped —
        // more than one matching locality can share the same city.
        const seen = new Map<string, CityResult>();
        for (const r of rows) {
          if (!r.cityAreaId) continue;
          if (!seen.has(r.cityAreaId)) {
            const cityName = r.cityName ?? r.label;
            seen.set(r.cityAreaId, { id: r.cityAreaId, name: cityName, label: cityName, viaLocality: r.name });
          }
        }
        setResults([...seen.values()]);
        setTotal(seen.size);
      } else {
        setResults(rows.map((r) => ({ id: r.id, name: r.name, label: r.label })));
        setTotal(rows.length);
      }
    } catch {
      if (requestId === requestIdRef.current) {
        setResults([]);
        setTotal(0);
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  function handleChange(value: string) {
    setQuery(value);
    void runSearch(value);
  }

  const trimmed = query.trim();
  const shown = results.slice(0, RESULT_CAP);

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={CITY_SEARCH_PLACEHOLDER}
        autoComplete="off"
        autoFocus={autoFocus}
      />
      <p className="text-xs text-muted-foreground">{CITY_SEARCH_HINT}</p>

      {trimmed.length < 1 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{AREA_SEARCH_EMPTY_HINT}</p>
      ) : !loading && shown.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{AREA_SEARCH_NO_MATCH}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {shown.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left hover:bg-accent"
                onClick={() => onSelect({ id: r.id, name: r.name })}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{r.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.viaLocality ? `via ${r.viaLocality}` : r.label}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {total > RESULT_CAP && <p className="text-center text-xs text-muted-foreground">{areaSearchCountHint(RESULT_CAP, total)}</p>}
    </div>
  );
}
