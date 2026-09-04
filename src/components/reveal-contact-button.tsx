"use client";

// §9 — "reveal-on-tap, never in page markup." The contact value is fetched
// only after a tap, never rendered into the page's initial HTML/SSR output.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { revealProfileContact } from "@/app/actions/reveal-contact";

export function RevealContactButton({ profileUserId }: { profileUserId: string }) {
  const [state, setState] = useState<{ value: string } | { error: string } | null>(null);
  const [loading, setLoading] = useState(false);

  if (state && "value" in state) {
    return <p className="text-sm font-medium">{state.value}</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        size="sm"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          setState(await revealProfileContact(profileUserId));
          setLoading(false);
        }}
      >
        {loading ? "Revealing…" : "Show contact"}
      </Button>
      {state && "error" in state && <p className="text-xs text-destructive">{state.error}</p>}
    </div>
  );
}
