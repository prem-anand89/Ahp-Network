// §4 — "On mobile user-agents, the 6-digit-code path remains the default,
// with the click-through link secondary." Email apps open magic links in
// an in-app browser that doesn't hold the session — a well-documented
// 30-40% drop — so the login page needs to know which flow to show first.

const MOBILE_UA_PATTERN = /Android|iPhone|iPad|iPod|Mobile/i;

export function isMobileUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return MOBILE_UA_PATTERN.test(userAgent);
}
