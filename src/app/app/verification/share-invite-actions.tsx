"use client";

// §10F — "Share" (the profile URL) and "Invite" (a second action alongside
// it, reusing the same mechanism) — entirely opt-in and personal, no
// reward layer.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createShareLink } from "./actions";
import { INVITE_WHATSAPP_MESSAGE_TEMPLATE } from "@/lib/copy";

export function ShareInviteActions() {
  const [status, setStatus] = useState<string | null>(null);

  async function handleShare() {
    setStatus(null);
    try {
      const url = await createShareLink("copy_link");
      await navigator.clipboard.writeText(url);
      setStatus("Link copied");
    } catch {
      setStatus("Couldn't create a link — please try again.");
    }
  }

  async function handleInvite() {
    setStatus(null);
    try {
      const url = await createShareLink("whatsapp");
      const text = `${INVITE_WHATSAPP_MESSAGE_TEMPLATE} ${url}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    } catch {
      setStatus("Couldn't create an invite — please try again.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={handleShare}>
          Share
        </Button>
        <Button size="sm" onClick={handleInvite}>
          Invite on WhatsApp
        </Button>
      </div>
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
    </div>
  );
}
