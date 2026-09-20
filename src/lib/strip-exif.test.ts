import { describe, expect, it } from "vitest";
import { stripExif, stripExifFromFile } from "./strip-exif";

// A minimal synthetic JPEG: SOI, an APP0/JFIF segment, an APP1/EXIF
// segment carrying the literal "Exif\0\0" marker, then SOS + arbitrary
// "scan data" through EOI. stripExif must remove exactly the APP1
// segment and leave every other byte untouched, including the opaque
// SOS-onward tail it never parses.
const SOI = [0xff, 0xd8];
const APP0_JFIF = [
  0xff, 0xe0, 0x00, 0x10, // marker, length = 16 (2 + 14 payload bytes)
  0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
  0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
];
const APP1_EXIF = [
  0xff, 0xe1, 0x00, 0x08, // marker, length = 8 (2 + 6 payload bytes)
  0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
];
const SOS_THROUGH_EOI = [0xff, 0xda, 0x00, 0x08, 0xaa, 0xbb, 0xcc, 0xdd, 0xff, 0xd9];

function makeJpeg(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([...SOI, ...APP0_JFIF, ...APP1_EXIF, ...SOS_THROUGH_EOI]);
}

describe("stripExif (Phase 2 — the compressOrFallback EXIF gap)", () => {
  it("removes the APP1/EXIF segment and nothing else", () => {
    const result = stripExif(makeJpeg());
    const expected = new Uint8Array([...SOI, ...APP0_JFIF, ...SOS_THROUGH_EOI]);
    expect([...result]).toEqual([...expected]);
  });

  it("the literal EXIF marker bytes are gone from the output", () => {
    const result = stripExif(makeJpeg());
    const hex = Buffer.from(result).toString("latin1");
    expect(hex).not.toContain("Exif\0\0");
  });

  it("returns non-JPEG input unchanged (no SOI marker)", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(stripExif(png)).toBe(png);
  });

  it("copies SOS-onward scan data through verbatim without parsing it", () => {
    const result = stripExif(makeJpeg());
    const tail = [...result].slice(-SOS_THROUGH_EOI.length);
    expect(tail).toEqual(SOS_THROUGH_EOI);
  });

  it("stripExifFromFile preserves the file's name and type", async () => {
    const file = new File([makeJpeg()], "selfie.jpg", { type: "image/jpeg" });
    const stripped = await stripExifFromFile(file);
    expect(stripped.name).toBe("selfie.jpg");
    expect(stripped.type).toBe("image/jpeg");
    const bytes = new Uint8Array(await stripped.arrayBuffer());
    expect([...bytes]).toEqual([...stripExif(makeJpeg())]);
  });
});
