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
import { AddToCircleButton } from "@/components/circles/add-to-circle-button";
import { TagPill } from "@/components/ui-ahp/tag-pill";
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
  /** Phase 5 — "Save to circle" on every ProfileCard, not just the full
   * profile page. The caller decides this (signed in, and not the
   * viewer's own card) since ProfileCard itself has no session access —
   * same `Boolean(viewerUserId) && viewerUserId !== profile.id` check
   * /pt/[slug]/page.tsx already uses. Both showAddToCircle and userId
   * are optional (fixture/preview call sites — /design, the homepage
   * hero, onboarding's own-profile preview — have neither a real backing
   * id nor any reason to show this), but the button only renders when
   * both are present. */
  showAddToCircle?: boolean;
  userId?: string;
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
  showAddToCircle,
  userId,
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
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[17px] font-semibold text-card-foreground">
            {displayName ?? "Unnamed profile"}
          </span>
          {role && <span className="text-sm text-muted-foreground">{ROLE_LABELS[role]}</span>}
        </div>
        {showAddToCircle && userId && (
          <div className="shrink-0">
            <AddToCircleButton therapistUserId={userId} />
          </div>
        )}
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
            <TagPill key={spec} category="specialty">
              {SPECIALIZATION_LABELS[spec] ?? spec}
            </TagPill>
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
