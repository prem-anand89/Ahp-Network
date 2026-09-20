"use client";

// Phase 3 — Places autocomplete for the practice-creation form. §6:
// Places is for practice ADDRESSES only, server-side proxied (the API
// key never reaches the browser — see google-places.ts). A single
// sessionToken carries across every keystroke and the final selection so
// Places bills the whole session as one lookup, not per-keystroke.

import { useEffect, useRef, useState } from "react";
import { searchPlaceSuggestions } from "@/app/app/practices/actions";
import { Input } from "@/components/ui/input";

export interface PlaceSelection {
  placeId: string;
  text: string;
  sessionToken: string;
}

const DEBOUNCE_MS = 300;

export function PlacesAutocomplete({
  onSelect,
  placeholder = "Search for the practice's address",
}: {
  onSelect: (selection: PlaceSelection) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [predictions, setPredictions] = useState<{ placeId: string; text: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const sessionTokenRef = useRef<string>(crypto.randomUUID());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  function handleChange(value: string) {
    setQuery(value);
    clearTimeout(debounceRef.current);
    if (value.trim().length < 3) {
      setPredictions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await searchPlaceSuggestions(value, sessionTokenRef.current);
        setPredictions(results);
        setOpen(true);
      } catch {
        setPredictions([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
  }

  function handleSelect(prediction: { placeId: string; text: string }) {
    setQuery(prediction.text);
    setOpen(false);
    onSelect({ placeId: prediction.placeId, text: prediction.text, sessionToken: sessionTokenRef.current });
    // A fresh session for the next distinct search — Places' own session
    // boundary is "one search through to one selection."
    sessionTokenRef.current = crypto.randomUUID();
  }

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => predictions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && predictions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-card border bg-card shadow-sm">
          {predictions.map((p) => (
            <li key={p.placeId}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                onMouseDown={() => handleSelect(p)}
              >
                {p.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      {loading && <p className="mt-1 text-xs text-muted-foreground">Searching…</p>}
    </div>
  );
}
