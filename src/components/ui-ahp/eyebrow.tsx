// AHP-DESIGN-SYSTEM.md: "Section eyebrow label — 11-11.5px / 700, uppercase,
// 0.03em tracking." One place for that exact combination so it's mechanical
// rather than re-typed (and re-drifted) at every call site.

import { cn } from "@/lib/utils";

export function Eyebrow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "text-[11px] font-bold uppercase tracking-wide text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
