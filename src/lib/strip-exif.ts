// §7 / Phase 2 — the one gap in the photo-upload path's EXIF handling.
// `compress-photo.ts`'s canvas re-encode drops EXIF as a side effect on
// the main path (canvas.drawImage never copies metadata), but
// `compressOrFallback` deliberately sends the ORIGINAL file when canvas
// compression fails on a low-memory Android — and that original still
// carries EXIF, including GPS, in a therapist's own selfie. This strips
// it by JPEG segment removal: byte-level, no pixel decode, cheap even on
// the weak phone that just failed to compress.
//
// JPEG structure after the SOI marker (0xFFD8) is a sequence of segments,
// each `0xFF <marker> <2-byte length, big-endian, includes itself>
// <payload>` — except a handful of standalone markers (TEM, the RSTn
// restart markers) that carry no length/payload at all. APP1 (0xFFE1) is
// where EXIF (and XMP, which can also carry a GPS sidecar) lives; this
// walks the segment list and drops every APP1, keeping everything else
// byte-for-byte. SOS (0xFFDA) ends the segment list — everything after it
// is compressed scan data, not more segments, and is copied through
// unmodified rather than parsed.

const SOI = 0xd8;
const APP1 = 0xe1;
const SOS = 0xda;
const TEM = 0x01;

function isStandaloneMarker(marker: number): boolean {
  return marker === TEM || (marker >= 0xd0 && marker <= 0xd9);
}

/** Non-JPEG input (no SOI marker) is returned unchanged — PNG/WebP don't
 * carry EXIF the same way, and this function is JPEG-specific by design. */
export function stripExif(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) {
    return bytes;
  }

  const kept: Uint8Array<ArrayBuffer>[] = [bytes.subarray(0, 2)];
  let offset = 2;

  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) break; // malformed — stop; the tail push below copies the rest verbatim

    const marker = bytes[offset + 1];
    if (marker === SOS) break;

    if (isStandaloneMarker(marker)) {
      kept.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }

    if (offset + 3 >= bytes.length) break; // truncated segment header
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const segmentEnd = offset + 2 + length;
    if (segmentEnd > bytes.length) break; // truncated segment body

    if (marker !== APP1) {
      kept.push(bytes.subarray(offset, segmentEnd));
    }
    offset = segmentEnd;
  }

  kept.push(bytes.subarray(offset));

  const total = kept.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const chunk of kept) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

/** File-level convenience wrapper — reads the file, strips EXIF, returns
 * a new File with the same name/type. */
export async function stripExifFromFile(file: File): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const stripped = stripExif(bytes);
  return new File([stripped], file.name, { type: file.type });
}
