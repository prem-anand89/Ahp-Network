"use client";

// §8A/§8A2/§10E (Phase 3 backend, Phase 8 UI) — the therapist-facing
// credential submission form. A single presigned PUT, not the chunked
// multipart path (src/lib/chunked-upload.ts) — credential documents are
// capped at 5MB (upload-validation.ts), well under the multipart
// threshold that primitive exists for. Validated by magic bytes before
// upload, not by file extension or the browser-reported MIME type.

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { requestCredentialUploadUrl, submitCredential, type SubmitCredentialInput } from "./actions";
import { validateUpload } from "@/lib/upload-validation";

type CredentialType = SubmitCredentialInput["type"];

const TYPE_LABELS: Record<CredentialType, string> = {
  degree: "Degree",
  postgraduate_degree: "Postgraduate degree",
  council_registration: "Council / statutory registration",
};

export interface CouncilOption {
  id: string;
  name: string;
}

export interface InstitutionOption {
  id: string;
  name: string;
}

export function CredentialUploadForm({
  councils,
  institutions,
  onSubmitted,
}: {
  councils: CouncilOption[];
  institutions: InstitutionOption[];
  onSubmitted?: () => void;
}) {
  const [type, setType] = useState<CredentialType>("degree");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    if (type === "council_registration" && !formData.get("councilId")) {
      setError("Choose a council.");
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

      const { url, objectKey } = await requestCredentialUploadUrl(file.type);
      const putRes = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!putRes.ok) {
        setError("Upload failed — please try again.");
        return;
      }

      await submitCredential({
        type,
        objectKey,
        registrationNumber: (formData.get("registrationNumber") as string) || undefined,
        institutionId: (formData.get("institutionId") as string) || undefined,
        councilId: (formData.get("councilId") as string) || undefined,
        expiryDate: (formData.get("expiryDate") as string) || undefined,
      });

      setDone(true);
      onSubmitted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return <p className="text-sm text-green-700">Uploaded — an admin will review it soon.</p>;
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="type" className="text-sm font-medium">
          Document type
        </label>
        <select
          id="type"
          value={type}
          onChange={(e) => setType(e.target.value as CredentialType)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {(type === "degree" || type === "postgraduate_degree") && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="institutionId" className="text-sm font-medium">
            Institution (optional)
          </label>
          <select id="institutionId" name="institutionId" className="rounded-md border bg-background px-3 py-2 text-sm">
            <option value="">Not listed / skip</option>
            {institutions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {type === "council_registration" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="councilId" className="text-sm font-medium">
            Council
          </label>
          <select id="councilId" name="councilId" required className="rounded-md border bg-background px-3 py-2 text-sm">
            <option value="">Choose one</option>
            {councils.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="registrationNumber" className="text-sm font-medium">
          Registration number (optional)
        </label>
        <input
          id="registrationNumber"
          name="registrationNumber"
          className="rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>

      {type === "council_registration" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="expiryDate" className="text-sm font-medium">
            Expiry date (optional)
          </label>
          <input
            id="expiryDate"
            name="expiryDate"
            type="date"
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="file" className="text-sm font-medium">
          Document — a clear phone photo is fine
        </label>
        <input id="file" ref={fileRef} type="file" accept="image/*,application/pdf" className="text-sm" />
      </div>

      {error && <p className="text-sm text-[color:var(--destructive)]">{error}</p>}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Uploading…" : "Submit"}
      </Button>
    </form>
  );
}
