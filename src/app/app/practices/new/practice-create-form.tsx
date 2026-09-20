"use client";

// Phase 3 — practice creation. §8C: any verified therapist can create a
// listing; it starts unclaimed and the owner claims it later with
// documentation (../[id]/claim). Manual address is the fallback when
// Places has no listing for the place.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlacesAutocomplete, type PlaceSelection } from "@/components/forms/places-autocomplete";
import { createPractice, type CreatePracticeInput } from "../actions";

const PRACTICE_TYPE_OPTIONS: { value: CreatePracticeInput["type"]; label: string }[] = [
  { value: "clinic", label: "Clinic" },
  { value: "hospital_department", label: "Hospital department" },
  { value: "home_care_agency", label: "Home care agency" },
  { value: "wellness_center", label: "Wellness center" },
  { value: "other", label: "Other" },
];

export function PracticeCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<CreatePracticeInput["type"]>("clinic");
  const [place, setPlace] = useState<PlaceSelection | null>(null);
  const [manualAddress, setManualAddress] = useState("");
  const [useManualAddress, setUseManualAddress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Practice name is required.");
      return;
    }
    if (!place && !manualAddress.trim()) {
      setError("Search for the address, or enter one manually.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await createPractice({
        name: name.trim(),
        type,
        placeId: place?.placeId,
        sessionToken: place?.sessionToken,
        manualAddress: useManualAddress || !place ? manualAddress.trim() || undefined : undefined,
      });
      router.push(`/app/practices/${result.id}/claim`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="practice-name">Practice name</Label>
        <Input id="practice-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="practice-type">Type</Label>
        <select
          id="practice-type"
          value={type}
          onChange={(e) => setType(e.target.value as CreatePracticeInput["type"])}
          className="rounded-input border-[1.5px] border-graphite bg-background px-3 py-2 text-sm"
        >
          {PRACTICE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {!useManualAddress ? (
        <div className="flex flex-col gap-1.5">
          <Label>Address</Label>
          <PlacesAutocomplete onSelect={setPlace} />
          <button
            type="button"
            className="self-start text-xs text-muted-foreground hover:underline"
            onClick={() => setUseManualAddress(true)}
          >
            Can&apos;t find it? Enter the address manually.
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="manual-address">Address</Label>
          <Input
            id="manual-address"
            value={manualAddress}
            onChange={(e) => setManualAddress(e.target.value)}
            placeholder="Full address"
          />
          <button
            type="button"
            className="self-start text-xs text-muted-foreground hover:underline"
            onClick={() => setUseManualAddress(false)}
          >
            Search instead
          </button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" loading={submitting} className="self-start">
        Add practice
      </Button>
    </form>
  );
}
