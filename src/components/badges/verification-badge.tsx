// THE locked verification badge component module (plan §1A, §8C3;
// ARCHITECTURE_REVIEW.md C3). "Credentials Verified," "Qualification
// Confirmed," and "Ownership Verified" carry genuinely different claims and
// must never be rendered as, or confused with, each other — so this file
// exports three separate named components, not one component with a `tier`
// prop. A `tier` prop would let a caller pass the wrong value; separate
// exports make that a type error instead.
//
// Never reimplement these per surface — every consumer (directory, profile
// pages, referral cards, the activity feed, the admin queue) imports from
// here. The verbatim §1A tooltip copy lives in src/lib/copy.ts, not
// hardcoded here, so a counsel wording change is a copy.ts diff only.
//
// Distinguishable by shape AND icon AND text, never colour alone (the E1
// token constraint recorded in globals.css) — each badge below differs in
// icon, corner radius, and border style, not just the accent colour token.
// Tooltip is a tap-triggered Popover, not a hover-only Tooltip — hover
// doesn't exist on the touch devices most of this product's users are on.

"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { ShieldCheck, GraduationCap, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CREDENTIALS_VERIFIED_LABEL,
  QUALIFICATION_CONFIRMED_LABEL,
  OWNERSHIP_VERIFIED_LABEL,
  credentialsVerifiedTooltip,
  qualificationConfirmedTooltip,
  ownershipVerifiedTooltip,
} from "@/lib/copy";

interface BadgeShellProps {
  label: string;
  tooltip: string;
  icon: React.ReactNode;
  className: string;
}

function BadgeShell({ label, tooltip, icon, className }: BadgeShellProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs font-medium",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {icon}
          {label}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          className="z-50 max-w-xs whitespace-pre-line rounded-md border bg-popover p-3 text-sm text-popover-foreground shadow-md"
        >
          {tooltip}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Full tier — plan §8A1a's `credentials_verified`. */
export function CredentialsVerifiedBadge({ dateLabel }: { dateLabel: string }) {
  return (
    <BadgeShell
      label={CREDENTIALS_VERIFIED_LABEL}
      tooltip={credentialsVerifiedTooltip(dateLabel)}
      icon={<ShieldCheck className="size-3.5" aria-hidden />}
      // Filled pill — solid fill uses --verified-text (the darker of the
      // two jade tokens, ~5.3:1 white-on-fill) rather than the lighter
      // --verified accent, which only clears AA at >=18px/icon sizes. Same
      // accessibility deviation recorded in globals.css, applied here.
      className="rounded-pill border-transparent bg-verified-text text-white"
    />
  );
}

/** Interim tier — plan §8A1a's `qualification_confirmed`. */
export function QualificationConfirmedBadge({ dateLabel }: { dateLabel: string }) {
  return (
    <BadgeShell
      label={QUALIFICATION_CONFIRMED_LABEL}
      tooltip={qualificationConfirmedTooltip(dateLabel)}
      icon={<GraduationCap className="size-3.5" aria-hidden />}
      // Outline pill — same rounded-pill shape as the full tier (that's
      // allowed; they differ by fill/border/text, tested below), but ink
      // outline on white instead of a filled tint.
      className="rounded-pill border-graphite bg-transparent text-confirmed"
    />
  );
}

/**
 * Practice badge — plan §8C3. A weaker, different claim than either
 * therapist badge (a business-registration document on file, not a
 * council-register check). Never render this alongside
 * CredentialsVerifiedBadge or QualificationConfirmedBadge on the same
 * entity — practices and therapists are different profile types, and this
 * component intentionally lives outside any shared "TherapistBadge" export
 * surface to make that mistake harder to make by accident.
 */
export function OwnershipVerifiedBadge({ dateLabel }: { dateLabel: string }) {
  return (
    <BadgeShell
      label={OWNERSHIP_VERIFIED_LABEL}
      tooltip={ownershipVerifiedTooltip(dateLabel)}
      icon={<Building2 className="size-3.5" aria-hidden />}
      // 8px rounded-rect in brick tint — deliberately never a pill, so a
      // practice badge can't be mistaken for a therapist badge at a
      // glance. --radius-seal exists in globals.css for exactly this one
      // consumer.
      className="rounded-seal border-brick-border bg-brick-bg text-brick"
    />
  );
}
