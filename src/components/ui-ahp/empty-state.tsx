// AHP-DESIGN-SYSTEM.md: "Empty states — bordered rounded panel with real,
// specific copy — never bare grey text floating with no container." Every
// current empty state in the app ("Nothing posted yet.", "No circles yet.",
// "Nothing here yet.") is exactly that bare floating sentence. This
// component is the one-shot fix for all of them (Phase 1's EmptyState
// sweep) — a bordered rounded panel, an icon slot, a title, a body, and an
// optional single action.

import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-card border border-dashed border-graphite bg-card px-6 py-10 text-center",
        className,
      )}
    >
      {icon && <div className="mb-1 text-muted-foreground">{icon}</div>}
      <p className="text-sm font-semibold">{title}</p>
      {body && <p className="max-w-sm text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
