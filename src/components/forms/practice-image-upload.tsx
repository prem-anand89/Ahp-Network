"use client";

// Phase 3 — practice logo/cover upload. Same browser-side-only discipline
// as photo-upload.tsx (canvas re-encode, EXIF stripped on the fallback
// path, Worker never touches the bytes) — reused rather than duplicated,
// parameterized only by shape since a logo and a cover image render
// differently but go through an identical upload path.

import { useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { validateUpload } from "@/lib/upload-validation";
import { compressOrFallback, canvasCompressor } from "@/lib/compress-photo";
import { stripExifFromFile } from "@/lib/strip-exif";
import { requestPracticeImageUploadUrl } from "@/app/app/practices/actions";

export interface PracticeImageUploadProps {
  initialUrl: string | null;
  shape: "circle" | "wide";
  label: string;
  onUploaded: (objectKey: string, previewUrl: string) => void;
}

export function PracticeImageUpload({ initialUrl, shape, label, onUploaded }: PracticeImageUploadProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialUrl);
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

      const { url, objectKey } = await requestPracticeImageUploadUrl(uploadFile.type);
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

  const previewClass =
    shape === "circle" ? "size-16 shrink-0 rounded-full object-cover" : "h-24 w-full rounded-card object-cover";

  return (
    <div className={shape === "circle" ? "flex items-center gap-4" : "flex flex-col gap-2"}>
      {previewUrl ? (
        <Image
          src={previewUrl}
          alt=""
          width={shape === "circle" ? 64 : 400}
          height={shape === "circle" ? 64 : 96}
          unoptimized
          className={previewClass}
        />
      ) : shape === "circle" ? (
        <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          ?
        </div>
      ) : (
        <div className="flex h-24 w-full items-center justify-center rounded-card bg-muted text-xs text-muted-foreground">
          No cover image
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          className="hidden"
          id={`practice-image-upload-${shape}`}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={state === "uploading"}
          onClick={() => fileRef.current?.click()}
        >
          {previewUrl ? `Change ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
