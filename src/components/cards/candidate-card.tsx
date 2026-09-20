// Phase 4 — the shortlist candidate card. The shortlist is the
// highest-stakes decision in the product (§8D: exactly 2 slots,
// first-to-accept-wins, patient details hidden until acceptance) and
// used to render each candidate as a bare checkbox + name string. This
// gives the poster what they'd want before committing: photo, verification
// badge, specializations, locality, and a link to the full profile —
// without ever showing anything the shortlist itself doesn't already
// reveal (no patient data, no comparative-evaluation language — §1A).

import Image from "next/image";
import Link from "next/link";
import { Check } from "lucide-react";
import {
  CredentialsVerifiedBadge,
  QualificationConfirmedBadge,
} from "@/components/badges/verification-badge";
import { SPECIALIZATION_LABELS } from "@/lib/referral-labels";
import { cn } from "@/lib/utils";

export interface CandidateCardProps {
  slug: string | null;
  displayName: string | null;
  photoUrl: string | null;
  specializations: string[];
  verificationStage: "unverified" | "qualification_confirmed" | "credentials_verified";
  localityLabel?: string | null;
  selected: boolean;
  /** true only for the "already chose 2, this is a 3rd" case — a
   * disabled-with-explanation control, never a silent no-op. */
  disabled: boolean;
  onToggle: () => void;
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function CandidateCard({
  slug,
  displayName,
  photoUrl,
  specializations,
  verificationStage,
  localityLabel,
  selected,
  disabled,
  onToggle,
}: CandidateCardProps) {
  return (
    <div
      role="checkbox"
      aria-checked={selected}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onToggle()}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-card border p-3 transition-colors",
        selected ? "border-primary bg-primary/5" : "border-input bg-card",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-graphite",
        )}
        aria-hidden
      >
        {selected && <Check className="size-3.5" />}
      </div>

      {photoUrl ? (
        <Image
          src={photoUrl}
          alt=""
          width={40}
          height={40}
          className="size-10 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
          {initials(displayName)}
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-semibold text-card-foreground">
            {displayName ?? "Unnamed profile"}
          </span>
          {verificationStage === "credentials_verified" && <CredentialsVerifiedBadge dateLabel="" />}
          {verificationStage === "qualification_confirmed" && <QualificationConfirmedBadge dateLabel="" />}
        </div>

        {(specializations.length > 0 || localityLabel) && (
          <p className="truncate text-xs text-muted-foreground">
            {specializations.map((s) => SPECIALIZATION_LABELS[s] ?? s).join(", ")}
            {specializations.length > 0 && localityLabel ? " · " : ""}
            {localityLabel}
          </p>
        )}

        {slug && (
          <Link
            href={`/pt/${slug}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="w-fit text-xs font-medium text-primary hover:underline"
          >
            View full profile
          </Link>
        )}
      </div>
    </div>
  );
}
