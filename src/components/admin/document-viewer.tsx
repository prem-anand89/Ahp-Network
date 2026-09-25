"use client";

// Phase 1 step 15 — minimal admin credential document viewer. On-demand
// (not eagerly fetched per queue row): a click calls the audited server
// action, gets a 120s presigned URL, and opens it — so an admin viewing
// the queue doesn't generate N signed URLs against a document nobody
// looked at.

import { useState } from "react";
import { getCredentialDocumentViewUrl } from "@/app/admin/(protected)/verification/actions";
import { Button } from "@/components/ui/button";

export function DocumentViewer({
  credentialId,
  hasBackDocument = false,
}: {
  credentialId: string;
  /** Step 7C — shows a second "View back" button when the therapist
   * uploaded a front/back pair. */
  hasBackDocument?: boolean;
}) {
  const [loadingSide, setLoadingSide] = useState<"front" | "back" | null>(null);
  const [error, setError] = useState<"front" | "back" | null>(null);

  async function handleView(side: "front" | "back") {
    setLoadingSide(side);
    setError(null);
    try {
      const url = await getCredentialDocumentViewUrl(credentialId, side);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setError(side);
    } finally {
      setLoadingSide(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => handleView("front")}
        loading={loadingSide === "front"}
      >
        View document
      </Button>
      {hasBackDocument && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => handleView("back")}
          loading={loadingSide === "back"}
        >
          View back
        </Button>
      )}
      {error && <span className="text-xs text-destructive">Couldn&apos;t open the document — try again.</span>}
    </div>
  );
}
