import { describe, expect, it } from "vitest";
import { isQuietHours, nextQuietHoursEnd } from "./quiet-hours";

// All UTC instants below are annotated with the IST wall-clock time they
// represent (UTC+5:30) so the intent is checkable without doing the
// arithmetic in your head.
describe("isQuietHours", () => {
  it("is true at 11PM IST", () => {
    // 2026-01-01 17:30 UTC = 2026-01-01 23:00 IST
    expect(isQuietHours(new Date("2026-01-01T17:30:00Z"))).toBe(true);
  });

  it("is true at 3AM IST", () => {
    // 2026-01-01 21:30 UTC = 2026-01-02 03:00 IST
    expect(isQuietHours(new Date("2026-01-01T21:30:00Z"))).toBe(true);
  });

  it("is false at 2PM IST", () => {
    // 2026-01-01 08:30 UTC = 2026-01-01 14:00 IST
    expect(isQuietHours(new Date("2026-01-01T08:30:00Z"))).toBe(false);
  });

  it("is true exactly at 10PM IST (inclusive start)", () => {
    // 2026-01-01 16:30 UTC = 2026-01-01 22:00 IST
    expect(isQuietHours(new Date("2026-01-01T16:30:00Z"))).toBe(true);
  });

  it("is false exactly at 7AM IST (exclusive end)", () => {
    // 2026-01-01 01:30 UTC = 2026-01-01 07:00 IST
    expect(isQuietHours(new Date("2026-01-01T01:30:00Z"))).toBe(false);
  });

  it("is true one minute before 7AM IST", () => {
    // 2026-01-01 01:29 UTC = 2026-01-01 06:59 IST
    expect(isQuietHours(new Date("2026-01-01T01:29:00Z"))).toBe(true);
  });
});

describe("nextQuietHoursEnd", () => {
  it("from 11PM IST, returns 7AM IST the next calendar day", () => {
    // 2026-01-01 17:30 UTC = 2026-01-01 23:00 IST
    const end = nextQuietHoursEnd(new Date("2026-01-01T17:30:00Z"));
    // 2026-01-02 07:00 IST = 2026-01-02 01:30 UTC
    expect(end.toISOString()).toBe("2026-01-02T01:30:00.000Z");
  });

  it("from 3AM IST, returns 7AM IST the same calendar day", () => {
    // 2026-01-02 21:30 UTC = 2026-01-03 03:00 IST
    const end = nextQuietHoursEnd(new Date("2026-01-02T21:30:00Z"));
    // 2026-01-03 07:00 IST = 2026-01-03 01:30 UTC
    expect(end.toISOString()).toBe("2026-01-03T01:30:00.000Z");
  });

  it("from daytime, still returns a future 7AM, never a time in the past", () => {
    // 2026-01-01 08:30 UTC = 2026-01-01 14:00 IST
    const now = new Date("2026-01-01T08:30:00Z");
    const end = nextQuietHoursEnd(now);
    expect(end.getTime()).toBeGreaterThan(now.getTime());
  });
});
