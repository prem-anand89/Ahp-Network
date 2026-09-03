// §7 — client-side compression before upload for photos, WebP/JPEG target
// <1MB. "Compression can fail outright on lower-memory Android devices —
// on failure, never discard the user's local file selection; preserve it,
// surface a plain retry, offer 'upload without compressing' as a
// fallback."
//
// The actual canvas work is isolated behind a `compressor` parameter so
// the fallback branching logic is testable without a real canvas — jsdom
// doesn't implement one, and canvas.toBlob is exactly the kind of thing
// that fails unpredictably on the real low-memory devices this rule is
// about, which is also awkward to reproduce faithfully in a test
// environment. Testing the fallback logic with an injectable compressor
// that we can force to fail is more honest than mocking a canvas API to
// pretend it works.

export type Compressor = (file: File) => Promise<File>;

export interface CompressionResult {
  file: File;
  /** false means compression failed and the original file is being used as-is. */
  compressed: boolean;
  error?: string;
}

export async function compressOrFallback(
  file: File,
  compressor: Compressor,
): Promise<CompressionResult> {
  try {
    const compressedFile = await compressor(file);
    return { file: compressedFile, compressed: true };
  } catch (err) {
    // Never discard the original selection — this is the one line that
    // rule exists for.
    return {
      file,
      compressed: false,
      error: err instanceof Error ? err.message : "Compression failed",
    };
  }
}

/**
 * The real canvas-based compressor — re-encodes as WebP targeting <1MB.
 * Not used directly in tests (see the module comment); production code
 * passes this to compressOrFallback.
 */
export async function canvasCompressor(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0);

  const targetBytes = 1024 * 1024;
  let quality = 0.9;
  let blob: Blob | null = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (!blob) throw new Error("canvas.toBlob returned null");
    if (blob.size <= targetBytes) break;
    quality -= 0.15;
  }

  if (!blob) throw new Error("Compression produced no output");
  return new File([blob], file.name.replace(/\.\w+$/, ".webp"), { type: "image/webp" });
}
