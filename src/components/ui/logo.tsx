// The wordmark — decided 2026-09-20 after a side-by-side comparison
// against the real hero page (not /design in isolation). variant="nunito"
// ships everywhere (site-nav.tsx, app-nav.tsx, app-tab-bar.tsx,
// footer.tsx); "newsreader" is kept as a one-line-swap standby per call
// site if that's ever preferred instead. Supersedes the earlier
// AhpMark (seal glyph + Inter/Newsreader) design-system mark, deleted in
// the same commit that adopted this.

import { Nunito, Newsreader } from "next/font/google";
import { cn } from "@/lib/utils";

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["900"],
});

// weight 700, not the same 400 used for body copy — a logo mark needs
// solid presence at small sizes.
const newsreaderLogo = Newsreader({
  subsets: ["latin"],
  weight: ["700"],
});

interface LogoProps {
  className?: string;
  /** Which typographic treatment to render. Defaults to the shipping
   * choice ("nunito"); pass "newsreader" to preview or switch to the
   * standby. */
  variant?: "nunito" | "newsreader";
}

export function Logo({ className, variant = "nunito" }: LogoProps) {
  // Select the appropriate font and letter-spacing based on the variant
  const fontClass = variant === "newsreader" ? newsreaderLogo.className : nunito.className;
  const trackingClass = variant === "newsreader" ? "tracking-tight" : "tracking-tighter";

  return (
    <div
      className={cn(
        "inline-block whitespace-nowrap leading-none select-none",
        fontClass,
        trackingClass,
        className
      )}
    >
      <span className="text-primary">ahp</span>
      <span className="text-foreground">network</span>
      {/* Deliberate one-off accent, not a design-system token — the
          wordmark's full stop, not reused anywhere else. */}
      <span className="text-[#e41e26]">.</span>
    </div>
  );
}
