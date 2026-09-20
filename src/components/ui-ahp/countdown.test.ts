// [G1]/Phase 4 — countdown.tsx's rewrite of offer-countdown.tsx: second
// resolution once under 5 minutes, since a bare "0m" for the last 4
// minutes of a 30-minute urgent window looks frozen.

import { describe, expect, it } from "vitest";
import { formatCountdown } from "./countdown";

describe("formatCountdown", () => {
  it("shows m:ss once under 5 minutes", () => {
    expect(formatCountdown(4 * 60_000 + 5_000)).toBe("4:05");
    expect(formatCountdown(59_000)).toBe("0:59");
  });

  it("pads single-digit seconds", () => {
    expect(formatCountdown(60_000 + 3_000)).toBe("1:03");
  });

  it("falls back to the coarser Xh Ym / Xm format at 5 minutes and above", () => {
    expect(formatCountdown(5 * 60_000)).toBe("5m");
    expect(formatCountdown(90 * 60_000)).toBe("1h 30m");
  });

  it("reads 0:00 once expired, never a negative time", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5000)).toBe("0:00");
  });
});
