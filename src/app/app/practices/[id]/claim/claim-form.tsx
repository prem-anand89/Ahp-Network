"use client";

// Phase 3 — practice ownership claim (§8C1). Same non-negotiable as
// credential review: never auto-approved, an admin must see the document.
// A single presigned PUT of a PDF (registration certificate, GST, trade
// licence) — same size cap and magic-byte check as credentials.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateUpload } from "@/lib/upload-validation";
import { requestClaimDocumentUploadUrl, submitPracticeClaim } from "../../actions";

export function ClaimForm({ practiceId }: { practiceId: string }) {
  const router = useRouter();
  const [relationship, setRelationship] = useState<"owner" | "manager">("owner");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ disputed: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Upload a document proving ownership or management (registration certificate, GST, trade licence).");
      return;
    }

    setSubmitting(true);
    try {
      const leadingBytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const validation = validateUpload("credential_document", file.size, leadingBytes);
      if (!validation.valid) {
        setError(validation.reason ?? "That file can't be uploaded.");
        return;
      }

      const { url, objectKey } = await requestClaimDocumentUploadUrl(file.type);
      const putRes = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!putRes.ok) {
        setError("Upload failed — please try again.");
        return;
      }

      const result = await submitPracticeClaim({
        practiceId,
        claimedRelationship: relationship,
        documentUrl: objectKey,
        registrationNumber: registrationNumber.trim() || undefined,
      });
      setDone(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-verified-text">Claim submitted — an admin will review it soon.</p>
        {done.disputed && (
          <p className="text-sm text-muted-foreground">
            Another claim is already open on this practice, so this one is frozen for admin review rather
            than resolved automatically.
          </p>
        )}
        <Button variant="outline" size="sm" className="self-start" onClick={() => router.push("/app/practices")}>
          Back to your practices
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="relationship">Your relationship to this practice</Label>
        <select
          id="relationship"
          value={relationship}
          onChange={(e) => setRelationship(e.target.value as "owner" | "manager")}
          className="rounded-input border-[1.5px] border-graphite bg-background px-3 py-2 text-sm"
        >
          <option value="owner">Owner</option>
          <option value="manager">Manager</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="registrationNumber">Business registration number (optional)</Label>
        <Input
          id="registrationNumber"
          value={registrationNumber}
          onChange={(e) => setRegistrationNumber(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="claim-file">Document (PDF) — registration certificate, GST, or trade licence</Label>
        <input id="claim-file" ref={fileRef} type="file" accept="application/pdf" className="text-sm" />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" loading={submitting} className="self-start">
        Submit claim
      </Button>
    </form>
  );
}
