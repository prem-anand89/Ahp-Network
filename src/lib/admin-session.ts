// §8G5's admin context separation: "/app/* for therapist work, /admin/*
// for admin work. Re-authentication to enter admin mode, with a 2-hour
// idle timeout. Unmissable visual distinction. audit_logs records the
// acting context."
//
// Admin mode is tracked by a short-lived, httpOnly cookie
// (admin_mode_activity_at) set only after a fresh re-authentication (the
// same OTP re-verify flow as login, entered again specifically to open
// admin mode — see (admin)/verify). Every request into /admin/* refreshes
// this cookie (a sliding idle window, not a fixed 2-hour session length)
// and the layout redirects back to re-verify once it's stale. This is
// deliberately separate from the therapist session's own 30-day cookie —
// one account, two contexts, two different lifetimes.

export const ADMIN_SESSION_IDLE_TIMEOUT_MINUTES = 120;
export const ADMIN_MODE_COOKIE_NAME = "admin_mode_activity_at";

export function isAdminSessionActive(
  lastActivityAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!lastActivityAt) return false;
  const idleMs = now.getTime() - lastActivityAt.getTime();
  return idleMs <= ADMIN_SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000;
}

export function parseAdminModeCookie(value: string | undefined): Date | null {
  if (!value) return null;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp);
}

export function currentAdminModeCookieValue(now: Date = new Date()): string {
  return String(now.getTime());
}
