import { describe, expect, it } from "vitest";
import { isMobileUserAgent } from "./is-mobile-user-agent";

describe("isMobileUserAgent (plan §4)", () => {
  it("detects common mobile user agents", () => {
    expect(
      isMobileUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36",
      ),
    ).toBe(true);
    expect(
      isMobileUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      ),
    ).toBe(true);
  });

  it("does not flag desktop user agents", () => {
    expect(
      isMobileUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
      ),
    ).toBe(false);
  });

  it("defaults to false for missing user-agent", () => {
    expect(isMobileUserAgent(null)).toBe(false);
    expect(isMobileUserAgent(undefined)).toBe(false);
    expect(isMobileUserAgent("")).toBe(false);
  });
});
