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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { proposeCouncil, requestCredentialUploadUrl, submitCredential, type SubmitCredentialInput } from "./actions";
import { validateUpload } from "@/lib/upload-validation";
import { COUNCIL_PROPOSE_COPY, CREDENTIAL_UPLOAD_COPY, CREDENTIAL_UPLOAD_GUIDANCE } from "@/lib/copy";
import { cn } from "@/lib/utils";

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
  // Step 7C — the document-type dropdown became two large cards. "Academic
  // degree" covers both `degree` and `postgraduate_degree`; a small
  // sub-choice appears once that card is picked, so the primary decision
  // stays a two-option one, matching the Fast Track banner's framing
  // (registration first, degree only as the qualification half).
  const [docGroup, setDocGroup] = useState<"council_registration" | "academic">("council_registration");
  const [academicType, setAcademicType] = useState<"degree" | "postgraduate_degree">("degree");
  const type: CredentialType = docGroup === "council_registration" ? "council_registration" : academicType;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [showBackFile, setShowBackFile] = useState(false);
  // Round 3 step B — "My council isn't listed." A proposed council isn't
  // spliced into the `councils` prop (that would need a full page reload
  // to reflect); instead it's tracked separately and rendered as a
  // read-only "using this" line once proposed, with councilId set via a
  // hidden input so submitCredential still gets it in formData like any
  // other Select-backed field.
  const [proposingCouncil, setProposingCouncil] = useState(false);
  const [proposedCouncil, setProposedCouncil] = useState<{ id: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const backFileRef = useRef<HTMLInputElement>(null);
  // Aborts any in-flight upload if the component unmounts mid-request
  // (e.g. the user navigates away) — without this, a late XHR
  // onload/onerror would call setState after unmount.
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortControllerRef.current?.abort();
  }, []);

  async function uploadOne(file: File, abortController: AbortController, onProgress: (p: number) => void) {
    const leadingBytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const validation = validateUpload("credential_document", file.size, leadingBytes);
    if (!validation.valid) throw new Error(validation.reason ?? CREDENTIAL_UPLOAD_COPY.invalidFileError);

    const { url, objectKey } = await requestCredentialUploadUrl(file.type);
    await putWithProgress(url, file, onProgress, abortController.signal);
    return objectKey;
  }

  async function handleSubmit(formData: FormData) {
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError(CREDENTIAL_UPLOAD_COPY.chooseFileError);
      return;
    }
    const backFile = showBackFile ? backFileRef.current?.files?.[0] : undefined;
    if (type === "council_registration" && !formData.get("councilId")) {
      setError(CREDENTIAL_UPLOAD_COPY.chooseCouncilError);
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setSubmitting(true);
    setUploadPercent(0);
    try {
      // Two sequential uploads (not parallel) so a single progress bar
      // stays meaningful — the front page's 0-100% completes, then the
      // back page's does, rather than two numbers racing each other.
      const objectKey = await uploadOne(file, abortController, setUploadPercent);
      const backObjectKey = backFile ? await uploadOne(backFile, abortController, setUploadPercent) : undefined;

      await submitCredential({
        type,
        objectKey,
        backObjectKey,
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
      {/* Round 2 — the two-factor requirement (registration AND one
          qualification document) is unchanged; this banner exists so
          "one qualification document" doesn't read as "just your degree
          certificate" to someone worried about uploading it. */}
      <div className="rounded-md border p-4 text-xs text-muted-foreground">
        {CREDENTIAL_UPLOAD_GUIDANCE.fastTrackBanner}
      </div>

      <RadioGroup
        value={docGroup}
        onValueChange={(v) => setDocGroup(v as typeof docGroup)}
        className="grid gap-2.5 sm:grid-cols-2"
      >
        {(
          [
            {
              value: "council_registration" as const,
              title: CREDENTIAL_UPLOAD_COPY.registrationCardTitle,
              body: CREDENTIAL_UPLOAD_COPY.registrationCardBody,
            },
            {
              value: "academic" as const,
              title: CREDENTIAL_UPLOAD_COPY.degreeCardTitle,
              body: CREDENTIAL_UPLOAD_COPY.degreeCardBody,
            },
          ]
        ).map((card) => (
          <label
            key={card.value}
            htmlFor={`docGroup-${card.value}`}
            className={cn(
              "flex cursor-pointer flex-col gap-1 rounded-card border p-4 transition-colors",
              docGroup === card.value ? "border-primary bg-secondary" : "border-border hover:bg-accent",
            )}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem id={`docGroup-${card.value}`} value={card.value} />
              <span className="text-sm font-semibold">{card.title}</span>
            </div>
            <p className="text-xs text-muted-foreground">{card.body}</p>
          </label>
        ))}
      </RadioGroup>

      {docGroup === "academic" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="academicType">Which document?</Label>
          <Select value={academicType} onValueChange={(v) => setAcademicType(v as typeof academicType)}>
            <SelectTrigger id="academicType" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="degree">{TYPE_LABELS.degree}</SelectItem>
              <SelectItem value="postgraduate_degree">{TYPE_LABELS.postgraduate_degree}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

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

          {proposedCouncil ? (
            <>
              <input type="hidden" name="councilId" value={proposedCouncil.id} />
              <p className="text-sm">
                {COUNCIL_PROPOSE_COPY.pendingNote(proposedCouncil.name)}{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    setProposedCouncil(null);
                    setProposingCouncil(false);
                  }}
                >
                  {COUNCIL_PROPOSE_COPY.cancelLabel}
                </button>
              </p>
            </>
          ) : proposingCouncil ? (
            <CouncilProposalForm
              onCancel={() => setProposingCouncil(false)}
              onProposed={(council) => {
                setProposedCouncil(council);
                setProposingCouncil(false);
              }}
            />
          ) : (
            <>
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
              <button
                type="button"
                className="self-start text-xs text-muted-foreground hover:underline"
                onClick={() => setProposingCouncil(true)}
              >
                {COUNCIL_PROPOSE_COPY.promptLink}
              </button>
            </>
          )}
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
        <p className="text-xs text-muted-foreground">{CREDENTIAL_UPLOAD_GUIDANCE.privacyNote}</p>
      </div>

      {showBackFile ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="backFile">Back of the document</Label>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => setShowBackFile(false)}
            >
              {CREDENTIAL_UPLOAD_COPY.removeBackPageLabel}
            </button>
          </div>
          <input id="backFile" ref={backFileRef} type="file" accept="image/*,application/pdf" className="text-sm" />
        </div>
      ) : (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground hover:underline"
          onClick={() => setShowBackFile(true)}
        >
          {CREDENTIAL_UPLOAD_COPY.addBackPageLabel}
        </button>
      )}

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

/** Round 3 step B — the "My council isn't listed" sub-form. Self-contained
 * (its own submitting/error state) since it's a small, one-shot action
 * nested inside the larger upload form, not part of that form's own
 * submit flow. */
function CouncilProposalForm({
  onCancel,
  onProposed,
}: {
  onCancel: () => void;
  onProposed: (council: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState("");
  const [state, setState] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    setError(null);
    setSubmitting(true);
    try {
      const { councilId } = await proposeCouncil(name, state);
      onProposed({ id: councilId, name: name.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : COUNCIL_PROPOSE_COPY.genericError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="proposedCouncilName">{COUNCIL_PROPOSE_COPY.nameLabel}</Label>
        <Input
          id="proposedCouncilName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={COUNCIL_PROPOSE_COPY.namePlaceholder}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="proposedCouncilState">{COUNCIL_PROPOSE_COPY.stateLabel}</Label>
        <Input
          id="proposedCouncilState"
          value={state}
          onChange={(e) => setState(e.target.value)}
          placeholder={COUNCIL_PROPOSE_COPY.statePlaceholder}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={submitting} onClick={handleAdd}>
          {COUNCIL_PROPOSE_COPY.submitLabel}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {COUNCIL_PROPOSE_COPY.cancelLabel}
        </Button>
      </div>
    </div>
  );
}
