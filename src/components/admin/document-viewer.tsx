"use client";

// Phase 1 step 15 — minimal admin credential document viewer. On-demand
// (not eagerly fetched per queue row): a click calls the audited server
// action, gets a 120s presigned URL, and opens it — so an admin viewing
// the queue doesn't generate N signed URLs against a document nobody
// looked at.

import { useState } from "react";
import { getCredentialDocumentViewUrl } from "@/app/admin/(protected)/verification/actions";
import { Button } from "@/components/ui/button";

export function DocumentViewer({ credentialId }: { credentialId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function handleView() {
    setState("loading");
    try {
      const url = await getCredentialDocumentViewUrl(credentialId);
      window.open(url, "_blank", "noopener,noreferrer");
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={handleView} loading={state === "loading"}>
        View document
      </Button>
      {state === "error" && (
        <span className="text-xs text-destructive">Couldn&apos;t open the document — try again.</span>
      )}
    </div>
  );
}
