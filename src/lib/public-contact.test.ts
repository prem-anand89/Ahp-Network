import { describe, expect, it } from "vitest";
import { decryptPublicContactValue, encryptPublicContactValue } from "./public-contact";

const TEST_KEY_B64 = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

describe("public_contact_value call site (§5, E2)", () => {
  it("round-trips a phone number and tags it with a key id for future rotation", async () => {
    const envelope = await encryptPublicContactValue("+91 98765 43210", TEST_KEY_B64);
    expect(envelope.kid).toBe("key-2026-09");
    expect(await decryptPublicContactValue(envelope, TEST_KEY_B64)).toBe("+91 98765 43210");
  });
});
