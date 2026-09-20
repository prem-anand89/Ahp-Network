// The AHP Network wordmark. AHP-DESIGN-SYSTEM.md flags the logo as
// unfinalized ("a gradient wordmark was tried and explicitly reverted;
// nav currently still uses the placeholder square-letter mark"). This is
// the concrete replacement: a seal glyph — a rounded-rect stamp with a
// check notch, echoing "a document, reviewed by a person" — the whole
// product's thesis — plus AHP in Inter 800 and the
// italic "Network" in Newsreader, matching every mockup's wordmark
// treatment. One SVG, no gradient.

import { cn } from "@/lib/utils";

export interface AhpMarkProps {
  /** Renders only the seal glyph, no wordmark text — for tight spaces
   * (mobile nav, favicon-adjacent contexts). */
  glyphOnly?: boolean;
  className?: string;
}

export function AhpMark({ glyphOnly = false, className }: AhpMarkProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg
        width="28"
        height="28"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect x="1.25" y="1.25" width="29.5" height="29.5" rx="9" className="fill-primary" />
        <path
          d="M9.5 16.4l4.3 4.3 8.7-8.7"
          stroke="white"
          strokeWidth="2.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {!glyphOnly && (
        <span className="text-[15px] font-extrabold tracking-tight">
          AHP <em className="font-display font-normal italic text-primary">Network</em>
        </span>
      )}
    </div>
  );
}
