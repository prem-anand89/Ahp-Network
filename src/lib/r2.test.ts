import { describe, expect, it } from "vitest";
import { AwsClient } from "aws4fetch";
import { getR2Client, r2ObjectUrl, CREDENTIALS_BUCKET, PHOTOS_BUCKET } from "./r2";

const testEnv = {
  CLOUDFLARE_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-key",
  R2_SECRET_ACCESS_KEY: "test-secret",
};

describe("getR2Client", () => {
  it("builds an S3-compatible client pointed at the R2 endpoint (never the native binding API)", () => {
    const { client, endpoint } = getR2Client(testEnv);
    expect(client).toBeInstanceOf(AwsClient);
    expect(endpoint).toBe("https://test-account.r2.cloudflarestorage.com");
  });

  it("names two distinct buckets: private credentials, public photos", () => {
    expect(CREDENTIALS_BUCKET).toBe("ahp-network-credentials");
    expect(PHOTOS_BUCKET).toBe("ahp-network-photos");
    expect(CREDENTIALS_BUCKET).not.toBe(PHOTOS_BUCKET);
  });
});

describe("r2ObjectUrl", () => {
  it("builds a URL preserving '/' as path separators within the key", () => {
    const url = r2ObjectUrl(testEnv, PHOTOS_BUCKET, "users/abc/profile.webp");
    expect(url).toBe("https://test-account.r2.cloudflarestorage.com/ahp-network-photos/users/abc/profile.webp");
  });
});
