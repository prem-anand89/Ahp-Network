"use client";

// Phase 2 — profile photo upload. Everything image-related happens in
// the browser, never in the Worker (Workers' 128MB memory ceiling would
// OOM decoding a 12MB phone photo server-side): canvasCompressor
// re-encodes through <canvas>, which drops EXIF as a side effect on the
// main path, then the file goes to R2 by presigned PUT so the Worker
// never touches the bytes.
//
// The one gap on the main path is compressOrFallback's fallback branch:
// it deliberately sends the ORIGINAL file when canvas compression fails
// on a low-memory Android, and that original still carries EXIF —
// including GPS in a therapist's own selfie. stripExifFromFile closes
// that gap on the fallback branch specifically, by byte-level JPEG
// segment removal, cheap even on the phone that just failed to compress.

import { useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { validateUpload } from "@/lib/upload-validation";
import { compressOrFallback, canvasCompressor } from "@/lib/compress-photo";
import { stripExifFromFile } from "@/lib/strip-exif";
import { requestProfilePhotoUploadUrl } from "@/app/app/profile/edit/actions";

export interface PhotoUploadProps {
  initialPhotoUrl: string | null;
  /** Called once a new photo has finished uploading to R2 — the parent
   * form holds the returned objectKey and includes it in its own save,
   * so the profile-edit screen commits everything in one action rather
   * than partially saving just the photo. */
  onUploaded: (objectKey: string, previewUrl: string) => void;
}

export function PhotoUpload({ initialPhotoUrl, onUploaded }: PhotoUploadProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPhotoUrl);
  const [state, setState] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFileChange() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setError(null);
    setState("uploading");
    try {
      const leadingBytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const validation = validateUpload("photo", file.size, leadingBytes);
      if (!validation.valid) {
        setError(validation.reason ?? "That file can't be uploaded.");
        setState("error");
        return;
      }

      const result = await compressOrFallback(file, canvasCompressor);
      const uploadFile = result.compressed
        ? result.file
        : result.file.type === "image/jpeg"
          ? await stripExifFromFile(result.file)
          : result.file;

      const { url, objectKey } = await requestProfilePhotoUploadUrl(uploadFile.type);
      const putRes = await fetch(url, {
        method: "PUT",
        body: uploadFile,
        headers: { "Content-Type": uploadFile.type },
      });
      if (!putRes.ok) {
        setError("Upload failed — please try again.");
        setState("error");
        return;
      }

      const localPreview = URL.createObjectURL(uploadFile);
      setPreviewUrl(localPreview);
      setState("idle");
      onUploaded(objectKey, localPreview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      setState("error");
    }
  }

  return (
    <div className="flex items-center gap-4">
      {previewUrl ? (
        <Image
          src={previewUrl}
          alt=""
          width={64}
          height={64}
          unoptimized
          className="size-16 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">
          ?
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          className="hidden"
          id="photo-upload-input"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={state === "uploading"}
          onClick={() => fileRef.current?.click()}
        >
          {previewUrl ? "Change photo" : "Add a photo"}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
