"use client";

// Phase 2 — the profile editor. Writes the fields onboarding never did:
// photoUrl, specializations, bio, ageGroupsServed, yearsExperience,
// languages, teleRehabAvailable, acceptsHomeVisits/acceptsClinicVisits.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CAPACITY_STATE_LABELS } from "@/lib/copy";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ChipMultiSelect } from "@/components/forms/chip-multi-select";
import { PhotoUpload } from "@/components/forms/photo-upload";
import { AreaCoveragePicker, type CoverageSelection } from "@/components/areas/area-coverage-picker";
import { SPECIALIZATION_OPTIONS, AGE_GROUP_OPTIONS, LANGUAGE_OPTIONS } from "@/lib/profile-options";
import type { MyCoverage } from "@/lib/coverage";
import { saveProfileDetails, saveMyCoverage } from "./actions";

export interface ProfileEditInitialValues {
  capacityState: "available" | "limited" | "not_taking";
  capacityNote: string | null;
  availableFrom: string | null;
  photoUrl: string | null;
  specializations: string[];
  ageGroupsServed: string[];
  bio: string;
  yearsExperience: number | null;
  languages: string[];
  teleRehabAvailable: boolean;
  acceptsHomeVisits: boolean;
  acceptsClinicVisits: boolean;
}

export function ProfileEditForm({ initial }: { initial: ProfileEditInitialValues }) {
  const router = useRouter();
  const [photoObjectKey, setPhotoObjectKey] = useState<string | undefined>(undefined);
  const [specializations, setSpecializations] = useState<string[]>(initial.specializations);
  const [ageGroupsServed, setAgeGroupsServed] = useState<string[]>(initial.ageGroupsServed);
  const [languages, setLanguages] = useState<string[]>(initial.languages);
  const [bio, setBio] = useState(initial.bio);
  const [yearsExperience, setYearsExperience] = useState(initial.yearsExperience?.toString() ?? "");
  const [teleRehabAvailable, setTeleRehabAvailable] = useState(initial.teleRehabAvailable);
  const [acceptsHomeVisits, setAcceptsHomeVisits] = useState(initial.acceptsHomeVisits);
  const [acceptsClinicVisits, setAcceptsClinicVisits] = useState(initial.acceptsClinicVisits);
  const [capacityState, setCapacityState] = useState(initial.capacityState);
  const [capacityNote, setCapacityNote] = useState(initial.capacityNote ?? "");
  const [availableFrom, setAvailableFrom] = useState(initial.availableFrom ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!acceptsHomeVisits && !acceptsClinicVisits) {
      setError("Keep at least one of home or clinic visits on.");
      return;
    }
    if (bio.length > 500) {
      setError("Bio must be 500 characters or fewer.");
      return;
    }

    setSubmitting(true);
    try {
      await saveProfileDetails({
        photoObjectKey,
        specializations,
        ageGroupsServed,
        bio,
        yearsExperience: yearsExperience.trim() ? Number(yearsExperience) : undefined,
        languages,
        teleRehabAvailable,
        acceptsHomeVisits,
        acceptsClinicVisits,
        capacityState,
        capacityNote: capacityNote.trim() || undefined,
        availableFrom: availableFrom || undefined,
      });
      router.push("/app/profile");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label>Photo</Label>
        <PhotoUpload
          initialPhotoUrl={initial.photoUrl}
          onUploaded={(objectKey) => setPhotoObjectKey(objectKey)}
        />
      </div>


      <div className="flex flex-col gap-3">
        <Label>Availability</Label>
        <RadioGroup value={capacityState} onValueChange={(v: "available" | "limited" | "not_taking") => setCapacityState(v)}>
          <div className="flex flex-col gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="available" id="capacity-available" />
              <Label htmlFor="capacity-available" className="font-normal">{CAPACITY_STATE_LABELS.available}</Label>
            </div>
            
            <div className="flex flex-col gap-2">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="limited" id="capacity-limited" />
                <Label htmlFor="capacity-limited" className="font-normal">{CAPACITY_STATE_LABELS.limited}</Label>
              </div>
              {capacityState === "limited" && (
                <div className="pl-6">
                  <Input 
                    value={capacityNote} 
                    onChange={(e) => setCapacityNote(e.target.value)} 
                    placeholder="e.g. Only taking home visits on weekends" 
                    maxLength={60} 
                  />
                  <p className="text-xs text-muted-foreground mt-1">Short note about your availability (optional, max 60 chars).</p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="not_taking" id="capacity-not-taking" />
                <Label htmlFor="capacity-not-taking" className="font-normal">{CAPACITY_STATE_LABELS.not_taking}</Label>
              </div>
              {capacityState === "not_taking" && (
                <div className="pl-6">
                  <Input 
                    type="date"
                    value={availableFrom} 
                    onChange={(e) => setAvailableFrom(e.target.value)} 
                  />
                  <p className="text-xs text-muted-foreground mt-1">When you might be available again (optional).</p>
                </div>
              )}
            </div>
          </div>
        </RadioGroup>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Specialties</Label>
        <ChipMultiSelect options={SPECIALIZATION_OPTIONS} value={specializations} onChange={setSpecializations} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Age groups served</Label>
        <ChipMultiSelect options={AGE_GROUP_OPTIONS} value={ageGroupsServed} onChange={setAgeGroupsServed} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Languages</Label>
        <ChipMultiSelect options={LANGUAGE_OPTIONS} value={languages} onChange={setLanguages} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="years-experience">Years of experience</Label>
        <Input
          id="years-experience"
          type="number"
          min={0}
          max={60}
          inputMode="numeric"
          value={yearsExperience}
          onChange={(e) => setYearsExperience(e.target.value)}
          className="max-w-32"
        />
      </div>

      {/* min-h-11: the checkbox itself is 16px, but the whole row is
          click-forwarding (Label wraps a labelable Radix Checkbox
          button), so the row height is the real touch target. */}
      <div className="flex flex-col">
        <Label className="min-h-11">
          <Checkbox checked={acceptsHomeVisits} onCheckedChange={(v) => setAcceptsHomeVisits(v === true)} />
          Accepts home visits
        </Label>
        <Label className="min-h-11">
          <Checkbox checked={acceptsClinicVisits} onCheckedChange={(v) => setAcceptsClinicVisits(v === true)} />
          Accepts clinic visits
        </Label>
        <Label className="min-h-11">
          <Checkbox checked={teleRehabAvailable} onCheckedChange={(v) => setTeleRehabAvailable(v === true)} />
          Tele-rehab available
        </Label>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="bio">Bio</Label>
          <span className="text-xs text-muted-foreground">{bio.length}/500</span>
        </div>
        <Textarea id="bio" rows={5} maxLength={500} value={bio} onChange={(e) => setBio(e.target.value)} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" loading={submitting} className="self-start">
        Save
      </Button>
    </form>
  );
}

export function WhereYouWorkSection({ initialCoverage }: { initialCoverage: MyCoverage }) {
  const primaryCityId = initialCoverage.coverage.find((r) => r.areaId === initialCoverage.baseAreaId)?.cityAreaId;
  const primaryCity = initialCoverage.cities.find((c) => c.id === primaryCityId);
  const [coverage, setCoverage] = useState<CoverageSelection[]>(initialCoverage.coverage);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    if (!initialCoverage.baseAreaId) return;
    setError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      await saveMyCoverage(initialCoverage.baseAreaId, coverage);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!initialCoverage.baseAreaId || !primaryCity) return null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-medium">Where you work</h2>
        <p className="text-sm text-muted-foreground">The areas you take home-visit referrals in.</p>
      </div>
      <AreaCoveragePicker
        primaryCity={primaryCity}
        baseAreaId={initialCoverage.baseAreaId}
        value={coverage}
        onChange={(v) => {
          setCoverage(v);
          setSaved(false);
        }}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
      <Button onClick={handleSave} loading={submitting} className="self-start">
        Save coverage
      </Button>
    </div>
  );
}
