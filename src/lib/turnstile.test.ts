import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstileToken } from "./turnstile";

describe("verifyTurnstileToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false for an empty token without calling Cloudflare", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(await verifyTurnstileToken("", "secret")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns true when siteverify responds success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }),
    );

    expect(await verifyTurnstileToken("a-real-token", "secret")).toBe(true);
  });

  it("returns false when siteverify responds failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }),
    );

    expect(await verifyTurnstileToken("a-forged-token", "secret")).toBe(false);
  });

  it("fails closed when the siteverify request itself errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    expect(await verifyTurnstileToken("a-real-token", "secret")).toBe(false);
  });

  it("fails closed on a non-ok HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    expect(await verifyTurnstileToken("a-real-token", "secret")).toBe(false);
  });

  it("includes remoteip in the request when provided, omits it for 'unknown'", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchSpy);

    await verifyTurnstileToken("tok", "secret", "1.2.3.4");
    const [, options] = fetchSpy.mock.calls[0];
    expect((options.body as URLSearchParams).get("remoteip")).toBe("1.2.3.4");

    await verifyTurnstileToken("tok", "secret", "unknown");
    const [, options2] = fetchSpy.mock.calls[1];
    expect((options2.body as URLSearchParams).get("remoteip")).toBeNull();
  });
});
