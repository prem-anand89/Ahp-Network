import { describe, expect, it } from "vitest";
import {
  isAdminSessionActive,
  parseAdminModeCookie,
  currentAdminModeCookieValue,
  ADMIN_SESSION_IDLE_TIMEOUT_MINUTES,
} from "./admin-session";

describe("isAdminSessionActive (§8G5 — 2-hour idle timeout)", () => {
  it("is active with no idle time elapsed", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(isAdminSessionActive(now, now)).toBe(true);
  });

  it("is active just under 2 hours idle", () => {
    const lastActivity = new Date("2026-01-01T10:01:00Z");
    const now = new Date("2026-01-01T12:00:00Z");
    expect(isAdminSessionActive(lastActivity, now)).toBe(true);
  });

  it("is inactive just over 2 hours idle", () => {
    const lastActivity = new Date("2026-01-01T09:59:00Z");
    const now = new Date("2026-01-01T12:00:00Z");
    expect(isAdminSessionActive(lastActivity, now)).toBe(false);
  });

  it("is inactive with no prior activity (never entered admin mode)", () => {
    expect(isAdminSessionActive(null)).toBe(false);
  });

  it("the constant actually says 120 minutes — the tests above assume that", () => {
    expect(ADMIN_SESSION_IDLE_TIMEOUT_MINUTES).toBe(120);
  });
});

describe("admin mode cookie round-trip", () => {
  it("parses a value it wrote itself back to the same instant", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const cookieValue = currentAdminModeCookieValue(now);
    expect(parseAdminModeCookie(cookieValue)?.getTime()).toBe(now.getTime());
  });

  it("treats missing or garbage cookie values as no prior activity", () => {
    expect(parseAdminModeCookie(undefined)).toBeNull();
    expect(parseAdminModeCookie("not-a-number")).toBeNull();
    expect(parseAdminModeCookie("")).toBeNull();
  });
});
