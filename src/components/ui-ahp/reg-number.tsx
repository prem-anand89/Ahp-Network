// AHP-DESIGN-SYSTEM.md's mono-font rule, made mechanical: IBM Plex Mono is
// reserved for exactly one job — a number that came from an official
// record (council registration numbers, credential IDs) — nowhere else.
// Wrapping every such number in this component, instead of hand-typing
// `font-mono` at each call site, is what keeps that rule from eroding one
// convenient exception at a time.

import { cn } from "@/lib/utils";

export function RegNumber({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("font-mono tabular-nums", className)} {...props} />;
}
