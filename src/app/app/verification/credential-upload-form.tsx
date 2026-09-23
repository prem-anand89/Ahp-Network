"use client";

// §8A/§8A2/§10E (Phase 3 backend, Phase 8 UI) — the therapist-facing
// credential submission form. A single presigned PUT, not the chunked
// multipart path (src/lib/chunked-upload.ts) — credential documents are
// capped at 5MB (upload-validation.ts), well under the multipart
// threshold that primitive exists for. Validated by magic bytes before
// upload, not by file extension or the browser-reported MIME type.

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { requestCredentialUploadUrl, submitCredential, type SubmitCredentialInput } from "./actions";
import { validateUpload } from "@/lib/upload-validation";

// fetch() gives no upload-progress events — XHR is the only browser
// primitive that does, which matters here specifically: a credential
// photo on a slow mobile upload can take real seconds, and a frozen
// "Uploading…" button with no feedback is the exact thing that makes
// someone tap it twice or bail before the police-verification-grade
// document ever lands in the admin queue.
function putWithProgress(url: string, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("Upload failed — please try again."));
    };
    xhr.onerror = () => reject(new Error("Upload failed — please try again."));
    xhr.send(file);
  });
}

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
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
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
    setUploadPercent(0);
    try {
      const leadingBytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const validation = validateUpload("credential_document", file.size, leadingBytes);
      if (!validation.valid) {
        setError(validation.reason ?? "That file can't be uploaded.");
        return;
      }

      const { url, objectKey } = await requestCredentialUploadUrl(file.type);
      await putWithProgress(url, file, setUploadPercent);

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
      setUploadPercent(null);
    }
  }

  if (done) {
    return <p className="text-sm text-verified-text">Uploaded — an admin will review it soon.</p>;
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="type">Document type</Label>
        <Select value={type} onValueChange={(v) => setType(v as CredentialType)}>
          <SelectTrigger id="type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(type === "degree" || type === "postgraduate_degree") && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="institutionId">Institution (optional)</Label>
          <Select name="institutionId">
            <SelectTrigger id="institutionId" className="w-full">
              <SelectValue placeholder="Not listed / skip" />
            </SelectTrigger>
            <SelectContent>
              {institutions.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {type === "council_registration" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="councilId">Council</Label>
          <Select name="councilId" required>
            <SelectTrigger id="councilId" className="w-full">
              <SelectValue placeholder="Choose one" />
            </SelectTrigger>
            <SelectContent>
              {councils.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="registrationNumber">Registration number (optional)</Label>
        <Input id="registrationNumber" name="registrationNumber" />
      </div>

      {type === "council_registration" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="expiryDate">Expiry date (optional)</Label>
          <Input id="expiryDate" name="expiryDate" type="date" />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="file">Document — a clear phone photo is fine</Label>
        <input id="file" ref={fileRef} type="file" accept="image/*,application/pdf" className="text-sm" />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {uploadPercent !== null && (
        <div className="flex flex-col gap-1">
          <div className="h-2 w-full overflow-hidden rounded-pill bg-muted" role="presentation">
            <div
              className="h-full rounded-pill bg-primary transition-[width]"
              style={{ width: `${uploadPercent}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground" role="status">
            Uploading — {uploadPercent}%
          </p>
        </div>
      )}

      <Button type="submit" disabled={submitting} loading={submitting}>
        {submitting ? "Uploading…" : "Submit"}
      </Button>
    </form>
  );
}
