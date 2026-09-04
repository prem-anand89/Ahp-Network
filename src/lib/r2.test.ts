import { describe, expect, it, vi } from "vitest";
import { AwsClient } from "aws4fetch";
import { getR2Client, r2FetchWithRetry, r2ObjectUrl, CREDENTIALS_BUCKET, PHOTOS_BUCKET } from "./r2";

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

describe("r2FetchWithRetry — the one AWS SDK behavior reintroduced by hand", () => {
  const client = new AwsClient({ accessKeyId: "k", secretAccessKey: "s" });

  it("returns the first response immediately on success", async () => {
    const ok = new Response("ok", { status: 200 });
    const fetchSpy = vi.spyOn(client, "fetch").mockResolvedValue(ok);
    const res = await r2FetchWithRetry(client, "https://example.com/obj");
    expect(res).toBe(ok);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries once on a 5xx and returns the retry's result", async () => {
    const failure = new Response("boom", { status: 503 });
    const success = new Response("ok", { status: 200 });
    const fetchSpy = vi.spyOn(client, "fetch").mockResolvedValueOnce(failure).mockResolvedValueOnce(success);
    const res = await r2FetchWithRetry(client, "https://example.com/obj");
    expect(res).toBe(success);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx — a bad signature or missing object won't fix itself", async () => {
    const notFound = new Response("nope", { status: 404 });
    const fetchSpy = vi.spyOn(client, "fetch").mockResolvedValue(notFound);
    const res = await r2FetchWithRetry(client, "https://example.com/obj");
    expect(res).toBe(notFound);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries once on a thrown network error", async () => {
    const success = new Response("ok", { status: 200 });
    const fetchSpy = vi
      .spyOn(client, "fetch")
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockResolvedValueOnce(success);
    const res = await r2FetchWithRetry(client, "https://example.com/obj");
    expect(res).toBe(success);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("never retries after the caller's own AbortSignal fired", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchSpy = vi
      .spyOn(client, "fetch")
      .mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(
      r2FetchWithRetry(client, "https://example.com/obj", { signal: controller.signal }),
    ).rejects.toThrow("aborted");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
