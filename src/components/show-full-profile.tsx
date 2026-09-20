"use client";

// Profile Card addendum §0 — progressive disclosure. A default-visible
// tier renders unconditionally; this wraps the collapsed tier behind one
// tap, per the same pattern §9 of the main plan already uses for the
// directory's default-4-filters / "more filters" split. Shared between
// /app/profile (the owner's own view) and /pt/[slug] (Phase 3's public
// rebuild) — promoted out of app/profile/ once a second route needed it.

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ShowFullProfile({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) return <>{children}</>;

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(true)}>
      Show full profile
    </Button>
  );
}
