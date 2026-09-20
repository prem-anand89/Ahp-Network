// Tag pills — deliberate deviation from AHP-DESIGN-SYSTEM.md's own spec.
// The proposal alternates plum/clay by DOM position (`nth-of-type`), which
// looks balanced but carries no meaning: reorder a card's tags and every
// colour association silently flips, and a user who's learned "plum means
// neuro" is wrong the next time the list re-sorts.
//
// Here colour is assigned by CATEGORY, stable regardless of order:
//   specialty   -> plum   (what is treated)
//   visitType   -> clay   (how the person is seen)
//   ageGroup    -> quiet outline (who is treated — a different axis, kept
//                  deliberately quieter, matching the design doc's own
//                  instinct to separate age tags structurally)
//   language    -> quiet outline (same reasoning as ageGroup)
//
// Never the sole signal for anything the app cares about distinguishing —
// this is decoration alongside the text, not instead of it.

import { cn } from "@/lib/utils";

export type TagCategory = "specialty" | "visitType" | "ageGroup" | "language";

const CATEGORY_CLASSES: Record<TagCategory, string> = {
  specialty: "bg-tag-plum text-tag-plum-fg",
  visitType: "bg-tag-clay text-tag-clay-fg",
  ageGroup: "border border-graphite bg-transparent text-foreground",
  language: "border border-graphite bg-transparent text-foreground",
};

export interface TagPillProps extends React.ComponentProps<"span"> {
  category: TagCategory;
}

export function TagPill({ category, className, ...props }: TagPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-3 py-1 text-xs font-semibold",
        CATEGORY_CLASSES[category],
        className,
      )}
      {...props}
    />
  );
}
