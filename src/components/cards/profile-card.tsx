// The therapist profile card — one of G9's two hero surfaces (the other is
// ReferralCard). Shared by /directory and §10F's OG image generation, so
// this is the product's actual face. Renders the locked badge module
// (never re-implements verification UI) and never any numeric or
// comparative claim about the therapist (§1A) — only the badge and
// structured facts.

import Image from "next/image";
import Link from "next/link";
import { MapPin } from "lucide-react";
import {
  CredentialsVerifiedBadge,
  QualificationConfirmedBadge,
} from "@/components/badges/verification-badge";
import { Card } from "@/components/ui/card";
import { SPECIALIZATION_LABELS } from "@/lib/referral-labels";
import { computeAvailabilityDisplay } from "@/lib/availability";

export interface ProfileCardProps {
  slug: string | null;
  displayName: string | null;
  photoUrl: string | null;
  role: "physiotherapist" | "occupational_therapist" | "speech_language_pathologist" | null;
  specializations: string[];
  verificationStage: "unverified" | "qualification_confirmed" | "credentials_verified";
  verifiedSinceLabel?: string;
  localityLabel?: string;
  availableForNewPatients: boolean;
  /** Drives the staleness check below — without it, a green dot left
   * untouched for months would keep reading as fresh forever. */
  availabilityUpdatedAt: Date | null;
}

const ROLE_LABELS: Record<NonNullable<ProfileCardProps["role"]>, string> = {
  physiotherapist: "Physiotherapist",
  occupational_therapist: "Occupational Therapist",
  speech_language_pathologist: "Speech-Language Pathologist",
};

function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function ProfileCard({
  slug,
  displayName,
  photoUrl,
  role,
  specializations,
  verificationStage,
  verifiedSinceLabel,
  localityLabel,
  availableForNewPatients,
  availabilityUpdatedAt,
}: ProfileCardProps) {
  const href = slug ? `/pt/${slug}` : "#";
  const availability = computeAvailabilityDisplay(availableForNewPatients, availabilityUpdatedAt);

  return (
    <Card className="gap-3.5 p-5">
      <div className="flex items-center gap-3">
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt=""
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-base font-semibold text-muted-foreground">
            {initials(displayName)}
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[17px] font-semibold text-card-foreground">
            {displayName ?? "Unnamed profile"}
          </span>
          {role && <span className="text-sm text-muted-foreground">{ROLE_LABELS[role]}</span>}
        </div>
      </div>

      {verificationStage === "credentials_verified" && (
        <CredentialsVerifiedBadge dateLabel={verifiedSinceLabel ?? ""} />
      )}
      {verificationStage === "qualification_confirmed" && (
        <QualificationConfirmedBadge dateLabel={verifiedSinceLabel ?? ""} />
      )}

      {specializations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {specializations.map((spec) => (
            <span
              key={spec}
              className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
            >
              {SPECIALIZATION_LABELS[spec] ?? spec}
            </span>
          ))}
        </div>
      )}

      {localityLabel && (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-3.5" aria-hidden />
          {localityLabel}
        </div>
      )}

      <div className="flex items-center justify-between border-t pt-2.5">
        {availability.kind === "available_fresh" ? (
          <div className="flex items-center gap-1.5 text-sm font-medium text-verified-text">
            <span className="size-1.5 rounded-full bg-verified" aria-hidden />
            Available for new patients
          </div>
        ) : availability.kind === "available_stale" ? (
          // A jade dot the therapist hasn't confirmed in 30+ days is a
          // lie by omission — this reads as neutral, not as unavailable
          // (they never said no, they just haven't said yes recently).
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden />
            Availability not confirmed recently
          </div>
        ) : (
          <span />
        )}
        <Link href={href} className="text-sm font-semibold hover:underline">
          View profile →
        </Link>
      </div>
    </Card>
  );
}
