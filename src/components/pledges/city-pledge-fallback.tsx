"use client";

// Round 2 step 6 (plan decision 1) — the onboarding-flow.tsx counterpart
// to Step 5's area-fallback-search.tsx: a therapist who can't complete
// step 2 because their city has no curated locality tree yet pledges
// instead of being stuck. Fixed city list (PLEDGE_CITY_OPTIONS), not
// free text — see pledges.ts for why.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PLEDGE_CITY_SECTION_BODY, PLEDGE_CITY_SECTION_TITLE, PLEDGE_NOT_IN_HYDERABAD_PROMPT } from "@/lib/copy";
import { PLEDGE_CITY_OPTIONS, PLEDGE_THRESHOLD } from "@/lib/pledge-options";
import { pledgeForCity } from "@/app/app/pledges/actions";

export function CityPledgeFallback({ onPledged }: { onPledged: (city: string, pledgeCount: number) => void }) {
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePledge() {
    setError(null);
    if (!city) {
      setError("Choose your city.");
      return;
    }
    setPending(true);
    try {
      const { pledgeCount } = await pledgeForCity(city);
      onPledged(city, pledgeCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="self-start text-xs text-muted-foreground hover:underline" onClick={() => setOpen(true)}>
        {PLEDGE_NOT_IN_HYDERABAD_PROMPT}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <p className="text-sm font-medium">{PLEDGE_CITY_SECTION_TITLE}</p>
      <p className="text-xs text-muted-foreground">{PLEDGE_CITY_SECTION_BODY}</p>
      <Select value={city} onValueChange={setCity}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Choose your city" />
        </SelectTrigger>
        <SelectContent>
          {PLEDGE_CITY_OPTIONS.map(({ name }) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="button" size="sm" disabled={pending} onClick={handlePledge} className="self-start">
        {pending ? "Pledging…" : `Pledge (${PLEDGE_THRESHOLD} needed to unlock)`}
      </Button>
    </div>
  );
}
