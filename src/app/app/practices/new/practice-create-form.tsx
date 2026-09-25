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
import { CityPicker, type CitySelection } from "@/components/areas/city-picker";
import { LocalityPicker, type LocalitySelection } from "@/components/areas/locality-picker";
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
  // Round 3 step C — the registry locality, separate from the Google
  // address above (see actions.ts's CreatePracticeInput comment).
  const [city, setCity] = useState<CitySelection | null>(null);
  const [locality, setLocality] = useState<LocalitySelection | null>(null);
  // Step 7H — asked at the end, not up front: the practice listing itself
  // is the same either way, this only decides where the form sends the
  // poster next. Undecided by default so a submit can't silently pick a
  // path for them.
  const [isOwnerOrManager, setIsOwnerOrManager] = useState<boolean | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [phone, setPhone] = useState("");
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
    if (isOwnerOrManager === null) {
      setError("Let us know whether you're the owner or manager.");
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
        areaId: locality?.id,
        isOwnerOrManager,
        websiteUrl: websiteUrl.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      // Only the owner/manager path goes into the documentation-based
      // claim flow (§8C) — someone who said "no" isn't in a position to
      // claim it, so they land on the listing itself instead.
      router.push(isOwnerOrManager ? `/app/practices/${result.id}/claim` : `/app/practices/${result.id}`);
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

      <div className="flex flex-col gap-1.5">
        <Label>Locality</Label>
        {!city ? (
          <CityPicker onSelect={setCity} />
        ) : !locality ? (
          <div className="flex flex-col gap-1.5">
            <button type="button" className="self-start text-xs text-muted-foreground hover:underline" onClick={() => setCity(null)}>
              Change city ({city.name})
            </button>
            <LocalityPicker cityAreaId={city.id} cityName={city.name} onSelect={setLocality} />
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span>
              {locality.name}, {city.name}
            </span>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => {
                setLocality(null);
                setCity(null);
              }}
            >
              Change
            </button>
          </div>
        )}
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

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="practice-website">Website (optional)</Label>
        <Input
          id="practice-website"
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          placeholder="https://…"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="practice-phone">Phone (optional)</Label>
        <Input id="practice-phone" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Are you the owner or manager of this practice?</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={isOwnerOrManager === true ? "default" : "outline"}
            size="sm"
            onClick={() => setIsOwnerOrManager(true)}
          >
            Yes
          </Button>
          <Button
            type="button"
            variant={isOwnerOrManager === false ? "default" : "outline"}
            size="sm"
            onClick={() => setIsOwnerOrManager(false)}
          >
            No
          </Button>
        </div>
        {isOwnerOrManager === true && (
          <p className="text-xs text-muted-foreground">You&apos;ll be asked to verify ownership next.</p>
        )}
        {isOwnerOrManager === false && (
          <p className="text-xs text-muted-foreground">
            The listing will start unclaimed — the actual owner or manager can claim it later.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" loading={submitting} className="self-start">
        Add practice
      </Button>
    </form>
  );
}
