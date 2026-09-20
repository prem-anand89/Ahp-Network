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
import { ChipMultiSelect } from "@/components/forms/chip-multi-select";
import { PhotoUpload } from "@/components/forms/photo-upload";
import { SPECIALIZATION_OPTIONS, AGE_GROUP_OPTIONS, LANGUAGE_OPTIONS } from "@/lib/profile-options";
import { saveProfileDetails } from "./actions";

export interface ProfileEditInitialValues {
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
