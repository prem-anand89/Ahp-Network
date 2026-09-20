// Deterministic-hue initials avatar for lists of DISTINCT entities that
// need to be told apart at a glance with no uploaded logo (communities,
// institutions) — a different job from a single therapist's own avatar,
// which is always one hue (primary-tinted, see ProfileCard) since there's
// only one of them to distinguish.
//
// Pulled out of src/lib/communities.ts's communityInitialsPlaceholder(),
// which is now a thin wrapper around this — one shared place instead of
// the logic living inline next to one caller.
//
// Palette deliberately excludes the app's three locked signal hues:
// primary blue (brand accent), verified jade (verification only, "cannot
// be reused for decoration" per the design doc), and seal brick (rationed
// to urgency/accept-decline). Every combination below is >=4.5:1 on its
// own background.

import { cn } from "@/lib/utils";

const PALETTE: readonly string[] = [
  "bg-tag-plum text-tag-plum-fg",
  "bg-tag-clay text-tag-clay-fg",
  "bg-amber-100 text-amber-800",
  "bg-violet-100 text-violet-800",
  "bg-slate-100 text-slate-700",
];

export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = (words[0]?.[0] ?? "?") + (words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "");
  return initials.toUpperCase();
}

export function hueClassFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export interface AvatarInitialsProps {
  name: string;
  size?: "sm" | "default" | "lg";
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarInitialsProps["size"]>, string> = {
  sm: "size-8 text-xs",
  default: "size-10 text-sm",
  lg: "size-14 text-lg",
};

export function AvatarInitials({ name, size = "default", className }: AvatarInitialsProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-display font-semibold",
        SIZE_CLASSES[size],
        hueClassFor(name),
        className,
      )}
      aria-hidden
    >
      {initialsFor(name)}
    </div>
  );
}
