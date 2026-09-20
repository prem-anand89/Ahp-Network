"use client";

// Phase 3 — the practice editor. Gated to owner/manager server-side
// (requirePracticeEditor); this form assumes the caller already has
// standing to be here.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PracticeImageUpload } from "@/components/forms/practice-image-upload";
import { savePracticeDetails } from "../../actions";

export interface PracticeEditInitialValues {
  bio: string;
  servicesOffered: string;
  specialties: string;
  websiteUrl: string;
  phone: string;
  email: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
}

export function PracticeEditForm({ practiceId, initial }: { practiceId: string; initial: PracticeEditInitialValues }) {
  const router = useRouter();
  const [logoObjectKey, setLogoObjectKey] = useState<string | undefined>(undefined);
  const [coverImageObjectKey, setCoverImageObjectKey] = useState<string | undefined>(undefined);
  const [bio, setBio] = useState(initial.bio);
  const [servicesOffered, setServicesOffered] = useState(initial.servicesOffered);
  const [specialties, setSpecialties] = useState(initial.specialties);
  const [websiteUrl, setWebsiteUrl] = useState(initial.websiteUrl);
  const [phone, setPhone] = useState(initial.phone);
  const [email, setEmail] = useState(initial.email);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (bio.length > 500) {
      setError("Bio must be 500 characters or fewer.");
      return;
    }

    setSubmitting(true);
    try {
      await savePracticeDetails(practiceId, {
        logoObjectKey,
        coverImageObjectKey,
        bio,
        servicesOffered: servicesOffered
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        specialties: specialties
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        websiteUrl: websiteUrl.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
      router.push("/app/practices");
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
        <Label>Logo</Label>
        <PracticeImageUpload
          initialUrl={initial.logoUrl}
          shape="circle"
          label="logo"
          onUploaded={(objectKey) => setLogoObjectKey(objectKey)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Cover image</Label>
        <PracticeImageUpload
          initialUrl={initial.coverImageUrl}
          shape="wide"
          label="cover image"
          onUploaded={(objectKey) => setCoverImageObjectKey(objectKey)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="bio">Bio</Label>
          <span className="text-xs text-muted-foreground">{bio.length}/500</span>
        </div>
        <Textarea id="bio" rows={5} maxLength={500} value={bio} onChange={(e) => setBio(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="services">Services offered (comma-separated)</Label>
        <Input id="services" value={servicesOffered} onChange={(e) => setServicesOffered(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="specialties">Specialties (comma-separated)</Label>
        <Input id="specialties" value={specialties} onChange={(e) => setSpecialties(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="website">Website</Label>
        <Input id="website" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" loading={submitting} className="self-start">
        Save
      </Button>
    </form>
  );
}
