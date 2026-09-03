import { describe, expect, it } from "vitest";
import { compressOrFallback, type Compressor } from "./compress-photo";

function makeFile(name = "photo.jpg", type = "image/jpeg"): File {
  return new File([new Uint8Array(1024)], name, { type });
}

describe("compressOrFallback (§7 — never discard the user's local file selection)", () => {
  it("returns the compressed file when compression succeeds", async () => {
    const original = makeFile();
    const compressed = makeFile("photo.webp", "image/webp");
    const compressor: Compressor = async () => compressed;

    const result = await compressOrFallback(original, compressor);
    expect(result.compressed).toBe(true);
    expect(result.file).toBe(compressed);
    expect(result.error).toBeUndefined();
  });

  it("falls back to the original file when compression throws — the file is never lost", async () => {
    const original = makeFile();
    const compressor: Compressor = async () => {
      throw new Error("out of memory");
    };

    const result = await compressOrFallback(original, compressor);
    expect(result.compressed).toBe(false);
    expect(result.file).toBe(original);
    expect(result.error).toBe("out of memory");
  });

  it("falls back with a generic message when the compressor throws a non-Error", async () => {
    const original = makeFile();
    const compressor: Compressor = async () => {
      throw "some string rejection";
    };

    const result = await compressOrFallback(original, compressor);
    expect(result.compressed).toBe(false);
    expect(result.file).toBe(original);
    expect(result.error).toBe("Compression failed");
  });
});
