"use client";

// Round 3 step C — real-time locality search scoped to one city, with a
// "can't find it" fallback that proposes a new locality (area-propose.ts)
// instead of Step 5's Google Places fallback. Same real-time discipline
// as CityPicker: nothing listed until typing starts, filtered on every
// keystroke, no debounce — and the same onChange-triggered fetch (not a
// useEffect keyed on query) with a ref-held request counter discarding
// stale responses.

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { searchAreasAction, proposeLocalityAction } from "@/app/app/areas/actions";
import {
  AREA_SEARCH_EMPTY_HINT,
  AREA_SEARCH_NO_MATCH,
  LOCALITY_NOT_LISTED_PROMPT,
  LOCALITY_PROPOSE_NAME_LABEL,
  LOCALITY_PROPOSE_NAME_PLACEHOLDER,
  localityPendingReviewNote,
  localitySearchPlaceholder,
  areaSearchCountHint,
} from "@/lib/copy";

const RESULT_CAP = 6;

export interface LocalitySelection {
  id: string;
  name: string;
}

interface LocalityResult {
  id: string;
  name: string;
  label: string;
}

export function LocalityPicker({
  cityAreaId,
  cityName,
  onSelect,
  autoFocus = false,
  /** Round 3 step D decision D3 — when given, "can't find it" requires a
   * zone choice before proposing (a referral posted at a zoneless
   * locality is only ever reachable by an exact-name coverage tick, per
   * review finding 7). Every other caller (onboarding, profile edit,
   * practice creation) omits this and proposes zoneless, unchanged. */
  requireZoneOptions,
}: {
  cityAreaId: string;
  cityName: string;
  onSelect: (locality: LocalitySelection) => void;
  autoFocus?: boolean;
  requireZoneOptions?: { id: string; name: string }[];
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LocalityResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [proposeName, setProposeName] = useState("");
  const [proposeZoneId, setProposeZoneId] = useState("");
  const [proposeSubmitting, setProposeSubmitting] = useState(false);
  const [proposedNote, setProposedNote] = useState<string | null>(null);
  const [proposeError, setProposeError] = useState<string | null>(null);
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
    try {
      // Round 3 step D review fix — this component hands back exactly one
      // locality (onSelect's LocalitySelection), never a zone; searching
      // 'zone' too let a result get picked that every downstream caller
      // then treated as a locality id. Harmless everywhere it was only
      // ever a display-order coincidence, but postReferralTx's server-
      // side area_level check (Round 3 step D) turns it into a hard
      // "Choose a specific locality, not a zone or city" error.
      const rows = await searchAreasAction(trimmed, { cityAreaId, levels: ["locality"] });
      if (requestId !== requestIdRef.current) return;
      setResults(rows.map((r) => ({ id: r.id, name: r.name, label: r.label })));
      setTotal(rows.length);
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

  async function handlePropose() {
    const name = proposeName.trim();
    if (!name) return;
    if (requireZoneOptions && requireZoneOptions.length > 0 && !proposeZoneId) return;
    setProposeError(null);
    setProposeSubmitting(true);
    try {
      const created = await proposeLocalityAction(name, cityAreaId, proposeZoneId || undefined);
      setProposedNote(localityPendingReviewNote(created.name));
      onSelect({ id: created.id, name: created.name });
      setProposing(false);
      setProposeName("");
      setProposeZoneId("");
    } catch (err) {
      setProposeError(err instanceof Error ? err.message : "Couldn't save that — try again.");
    } finally {
      setProposeSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={localitySearchPlaceholder(cityName)}
        autoComplete="off"
        autoFocus={autoFocus}
      />

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
                  <span className="block truncate text-xs text-muted-foreground">{r.label}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {total > RESULT_CAP && <p className="text-center text-xs text-muted-foreground">{areaSearchCountHint(RESULT_CAP, total)}</p>}

      {proposedNote && <p className="text-xs text-muted-foreground">{proposedNote}</p>}

      {!proposing ? (
        <Button type="button" variant="link" size="sm" className="self-start px-0" onClick={() => setProposing(true)}>
          {LOCALITY_NOT_LISTED_PROMPT}
        </Button>
      ) : (
        <div className="flex flex-col gap-1.5 rounded-md border p-2.5">
          <label className="text-xs font-medium" htmlFor="propose-locality-name">
            {LOCALITY_PROPOSE_NAME_LABEL}
          </label>
          <Input
            id="propose-locality-name"
            value={proposeName}
            onChange={(e) => setProposeName(e.target.value)}
            placeholder={LOCALITY_PROPOSE_NAME_PLACEHOLDER}
            autoComplete="off"
          />
          {requireZoneOptions && requireZoneOptions.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium" htmlFor="propose-locality-zone">
                Which area of {cityName}?
              </label>
              <select
                id="propose-locality-zone"
                value={proposeZoneId}
                onChange={(e) => setProposeZoneId(e.target.value)}
                className="rounded-input border-[1.5px] border-graphite bg-background px-3 py-2 text-sm"
              >
                <option value="">Choose one</option>
                {requireZoneOptions.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {proposeError && <p className="text-xs text-destructive">{proposeError}</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={
                !proposeName.trim() ||
                (Boolean(requireZoneOptions) && requireZoneOptions!.length > 0 && !proposeZoneId) ||
                proposeSubmitting
              }
              onClick={handlePropose}
            >
              Use this name
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setProposing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
