// Round 2 — the nighttime pause for routine (never urgent) notifications
// and, later, routine offer deadlines. India has a single fixed +05:30
// UTC offset with no daylight saving, so "IST wall-clock time" can be
// computed by adding 5.5 hours to the UTC instant — no timezone database
// or Intl.DateTimeFormat needed, and no DST edge cases to get wrong.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const QUIET_START_HOUR = 22; // 10PM IST
const QUIET_END_HOUR = 7; // 7AM IST
const DAY_MS = 24 * 60 * 60 * 1000;

/** The IST wall-clock hour (0-23) for a given UTC instant. */
function istHour(date: Date): number {
  const istMs = date.getTime() + IST_OFFSET_MS;
  return new Date(istMs).getUTCHours();
}

/** True if `date` falls inside the 10PM-7AM IST quiet window. */
export function isQuietHours(date: Date): boolean {
  const hour = istHour(date);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/**
 * The next 7AM IST at or after `date`. Used both to defer a routine
 * push/email queued during quiet hours, and (Round 2 referral-engine
 * work) to push a routine offer's deadline past the window it would
 * otherwise span.
 */
export function nextQuietHoursEnd(date: Date): Date {
  const istMs = date.getTime() + IST_OFFSET_MS;
  const ist = new Date(istMs);
  const hour = ist.getUTCHours();

  const istMidnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  let endIstMs = istMidnight + QUIET_END_HOUR * 60 * 60 * 1000;
  // Before 7AM: today's 7AM is still ahead. From 7AM up to (not including)
  // 10PM: not in quiet hours, but if this is ever called anyway, roll to
  // tomorrow's 7AM rather than returning a time in the past. From 10PM
  // onward: tomorrow's 7AM.
  if (hour >= QUIET_END_HOUR) {
    endIstMs += DAY_MS;
  }

  return new Date(endIstMs - IST_OFFSET_MS);
}
