"use client";

// §9 — "reveal-on-tap, never in page markup." The contact value is fetched
// only after a tap, never rendered into the page's initial HTML/SSR output.
//
// Turnstile widget mounted here (2026-09-21) rather than an npm wrapper
// package — it's a single script tag + one render() call, not worth a
// dependency. NEXT_PUBLIC_TURNSTILE_SITE_KEY unset (e.g. an environment
// that hasn't been given keys yet) means the widget never mounts and the
// button stays enabled without a token — the server independently decides
// whether to enforce verification based on whether it has the matching
// secret (see reveal-contact.ts), so this can't be a bypass, only a
// no-op in an environment that isn't enforcing yet anyway.

import { useRef, useState } from "react";
import Script from "next/script";
import { Button } from "@/components/ui/button";
import { revealProfileContact } from "@/app/actions/reveal-contact";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: { sitekey: string; callback: (token: string) => void },
      ) => string;
    };
  }
}

export function RevealContactButton({ profileUserId }: { profileUserId: string }) {
  const [state, setState] = useState<{ value: string } | { error: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  function mountWidget() {
    if (mounted.current || !SITE_KEY || !window.turnstile || !containerRef.current) return;
    mounted.current = true;
    window.turnstile.render(containerRef.current, { sitekey: SITE_KEY, callback: setToken });
  }

  if (state && "value" in state) {
    return <p className="text-sm font-medium">{state.value}</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {SITE_KEY && (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer onLoad={mountWidget} />
      )}
      <div ref={containerRef} />
      <Button
        size="sm"
        disabled={loading || (Boolean(SITE_KEY) && !token)}
        onClick={async () => {
          setLoading(true);
          setState(await revealProfileContact(profileUserId, token ?? ""));
          setLoading(false);
        }}
      >
        {loading ? "Revealing…" : "Show contact"}
      </Button>
      {state && "error" in state && <p className="text-xs text-destructive">{state.error}</p>}
    </div>
  );
}
