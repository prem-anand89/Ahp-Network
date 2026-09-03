import { describe, expect, it } from "vitest";
import { decryptField, encryptField, importEncryptionKey } from "./crypto";

// A fixed 256-bit test key, base64-encoded — never the real Workers Secret.
const TEST_KEY_B64 = btoa(
  String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
);

describe("encryption envelope (plan §5)", () => {
  it("round-trips a plaintext value through the exact envelope shape", async () => {
    const key = await importEncryptionKey(TEST_KEY_B64);
    const envelope = await encryptField("+91 98765 43210", key, "key-2026-08");

    expect(envelope).toMatchObject({
      v: 1,
      kid: "key-2026-08",
      alg: "AES-256-GCM",
    });
    expect(typeof envelope.iv).toBe("string");
    expect(typeof envelope.ct).toBe("string");
    expect(typeof envelope.tag).toBe("string");

    const decrypted = await decryptField(envelope, key);
    expect(decrypted).toBe("+91 98765 43210");
  });

  it("produces a different iv (and ciphertext) on every call — never reused", async () => {
    const key = await importEncryptionKey(TEST_KEY_B64);
    const a = await encryptField("same value", key, "key-2026-08");
    const b = await encryptField("same value", key, "key-2026-08");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("negative control: fails to decrypt if the ciphertext is tampered with", async () => {
    const key = await importEncryptionKey(TEST_KEY_B64);
    const envelope = await encryptField("+91 98765 43210", key, "key-2026-08");
    const tampered = { ...envelope, ct: envelope.ct.slice(0, -4) + "abcd" };
    await expect(decryptField(tampered, key)).rejects.toThrow();
  });

  it("negative control: fails to decrypt with the wrong key", async () => {
    const key = await importEncryptionKey(TEST_KEY_B64);
    const wrongKey = await importEncryptionKey(
      btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
    );
    const envelope = await encryptField("+91 98765 43210", key, "key-2026-08");
    await expect(decryptField(envelope, wrongKey)).rejects.toThrow();
  });

  it("rejects an envelope with an unsupported version", async () => {
    const key = await importEncryptionKey(TEST_KEY_B64);
    const envelope = await encryptField("x", key, "key-2026-08");
    await expect(
      decryptField({ ...envelope, v: 2 as unknown as 1 }, key),
    ).rejects.toThrow(/Unsupported envelope version/);
  });
});
