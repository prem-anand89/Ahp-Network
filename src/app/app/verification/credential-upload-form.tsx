"use client";

// §8A/§8A2/§10E (Phase 3 backend, Phase 8 UI) — the therapist-facing
// credential submission form. A single presigned PUT, not the chunked
// multipart path (src/lib/chunked-upload.ts) — credential documents are
// capped at 5MB (upload-validation.ts), well under the multipart
// threshold that primitive exists for. Validated by magic bytes before
// upload, not by file extension or the browser-reported MIME type.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { requestCredentialUploadUrl, submitCredential, type SubmitCredentialInput } from "./actions";
import { validateUpload } from "@/lib/upload-validation";
import { CREDENTIAL_UPLOAD_COPY } from "@/lib/copy";

// fetch() gives no upload-progress events — XHR is the only browser
// primitive that does, which matters here specifically: a credential
// photo on a slow mobile upload can take real seconds, and a frozen
// "Uploading…" button with no feedback is the exact thing that makes
// someone tap it twice or bail before the police-verification-grade
// document ever lands in the admin queue.
//
// Takes an AbortSignal so the caller can cancel cleanly if the component
// unmounts mid-upload (e.g. the user navigates away) — without this, a
// late onload/onerror would call the caller's state setters after
// unmount. abort() fires 'abort', not 'error'; the caller distinguishes
// that rejection and treats it as a silent no-op, not a surfaced error.
function putWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(CREDENTIAL_UPLOAD_COPY.uploadFailedError));
    };
    xhr.onerror = () => reject(new Error(CREDENTIAL_UPLOAD_COPY.uploadFailedError));
    // abort() fires the 'abort' event, not 'error' — reject with a
    // recognizable AbortError so the caller can swallow it silently
    // instead of surfacing "upload failed" for a deliberate cancellation.
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort());
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
  // Aborts any in-flight upload if the component unmounts mid-request
  // (e.g. the user navigates away) — without this, a late XHR
  // onload/onerror would call setState after unmount.
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortControllerRef.current?.abort();
  }, []);

  async function handleSubmit(formData: FormData) {
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError(CREDENTIAL_UPLOAD_COPY.chooseFileError);
      return;
    }
    if (type === "council_registration" && !formData.get("councilId")) {
      setError(CREDENTIAL_UPLOAD_COPY.chooseCouncilError);
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setSubmitting(true);
    setUploadPercent(0);
    try {
      const leadingBytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const validation = validateUpload("credential_document", file.size, leadingBytes);
      if (!validation.valid) {
        setError(validation.reason ?? CREDENTIAL_UPLOAD_COPY.invalidFileError);
        return;
      }

      const { url, objectKey } = await requestCredentialUploadUrl(file.type);
      await putWithProgress(url, file, setUploadPercent, abortController.signal);

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
      // A deliberate abort (unmount) isn't a failure to surface — the
      // component is on its way out, and there's often nothing left to
      // update state on by the time this runs.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : CREDENTIAL_UPLOAD_COPY.genericError);
    } finally {
      // Skip state updates once aborted — the component may already be
      // unmounted by the time this runs.
      if (!abortController.signal.aborted) {
        setSubmitting(false);
        setUploadPercent(null);
      }
    }
  }

  if (done) {
    return <p className="text-sm text-verified-text">{CREDENTIAL_UPLOAD_COPY.doneLabel}</p>;
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
            {CREDENTIAL_UPLOAD_COPY.uploadProgressLabel(uploadPercent)}
          </p>
        </div>
      )}

      <Button type="submit" disabled={submitting} loading={submitting}>
        {submitting ? CREDENTIAL_UPLOAD_COPY.uploadingLabel : CREDENTIAL_UPLOAD_COPY.submitLabel}
      </Button>
    </form>
  );
}
