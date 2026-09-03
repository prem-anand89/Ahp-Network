import { describe, expect, it } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { getR2Client, CREDENTIALS_BUCKET, PHOTOS_BUCKET } from "./r2";

describe("getR2Client", () => {
  it("builds an S3-compatible client pointed at the R2 endpoint (never the native binding API)", async () => {
    const client = getR2Client({
      CLOUDFLARE_ACCOUNT_ID: "test-account",
      R2_ACCESS_KEY_ID: "test-key",
      R2_SECRET_ACCESS_KEY: "test-secret",
    });
    expect(client).toBeInstanceOf(S3Client);
    const endpoint = await client.config.endpoint?.();
    expect(endpoint?.hostname).toBe("test-account.r2.cloudflarestorage.com");
  });

  it("names two distinct buckets: private credentials, public photos", () => {
    expect(CREDENTIALS_BUCKET).toBe("ahp-network-credentials");
    expect(PHOTOS_BUCKET).toBe("ahp-network-photos");
    expect(CREDENTIALS_BUCKET).not.toBe(PHOTOS_BUCKET);
  });
});
