import { describe, expect, it } from "vitest";
import { createPresignedUploadUrl } from "./r2-presign";

const testEnv = {
  CLOUDFLARE_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-key",
  R2_SECRET_ACCESS_KEY: "test-secret",
};

describe("createPresignedUploadUrl (§7)", () => {
  it("signs a URL for an allowed photo content-type, scoped to the photos bucket", async () => {
    const url = await createPresignedUploadUrl(testEnv, {
      kind: "photo",
      contentType: "image/webp",
      objectKey: "users/abc/profile.webp",
    });
    expect(url).toContain("ahp-network-photos");
    expect(url).toContain("users/abc/profile.webp");
    expect(url).toMatch(/X-Amz-Signature=/);
  });

  it("signs a URL for a credential document, scoped to the private credentials bucket", async () => {
    const url = await createPresignedUploadUrl(testEnv, {
      kind: "credential_document",
      contentType: "application/pdf",
      objectKey: "users/abc/degree.pdf",
    });
    expect(url).toContain("ahp-network-credentials");
  });

  it("rejects a content-type not on the whitelist for that kind", async () => {
    await expect(
      createPresignedUploadUrl(testEnv, {
        kind: "photo",
        contentType: "application/pdf",
        objectKey: "users/abc/x",
      }),
    ).rejects.toThrow(/not allowed/);
  });
});
