import { describe, expect, it } from "vitest";
import { DB_CLIENT_MAX_CACHE_MS, isDbClientReusable } from "./db";

describe("db client reuse window", () => {
  it("reuses a client younger than the cache TTL", () => {
    const now = 1_000_000;
    expect(isDbClientReusable(now - 1_000, now)).toBe(true);
  });

  it("does not reuse a client at or past the cache TTL", () => {
    const now = 1_000_000;
    expect(isDbClientReusable(now - DB_CLIENT_MAX_CACHE_MS, now)).toBe(false);
    expect(isDbClientReusable(now - DB_CLIENT_MAX_CACHE_MS - 1, now)).toBe(false);
  });

  it("keeps the reuse window below postgres.js idle_timeout (20s)", () => {
    expect(DB_CLIENT_MAX_CACHE_MS).toBeLessThan(20_000);
  });
});
