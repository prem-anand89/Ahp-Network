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
}

const ROLE_LABELS: Record<NonNullable<ProfileCardProps["role"]>, string> = {
  physiotherapist: "Physiotherapist",
  occupational_therapist: "Occupational Therapist",
  speech_language_pathologist: "Speech-Language Pathologist",
};

const SPECIALIZATION_LABELS: Record<string, string> = {
  musculoskeletal_orthopaedic: "Musculoskeletal / Orthopaedic",
  neuro_rehab: "Neuro Rehab",
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
}: ProfileCardProps) {
  const href = slug ? `/pt/${slug}` : "#";

  return (
    <div className="flex flex-col gap-3.5 rounded-2xl border bg-card p-5 shadow-sm">
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
        {availableForNewPatients ? (
          <div className="flex items-center gap-1.5 text-sm font-medium text-[color:var(--color-verified)]">
            <span className="size-1.5 rounded-full bg-[color:var(--color-verified)]" aria-hidden />
            Available for new patients
          </div>
        ) : (
          <span />
        )}
        <Link href={href} className="text-sm font-semibold hover:underline">
          View profile →
        </Link>
      </div>
    </div>
  );
}
