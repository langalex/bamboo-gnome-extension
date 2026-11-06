import type { ClockEntry } from "./types.js";

/** Human-readable summary of the current clock state. */
export interface TodaySummary {
  /** True when there is an open clock entry (clocked in right now). */
  clockedIn: boolean;
  /** Start time of the open entry, if clocked in. */
  clockedInSince: Date | null;
  /** Today's closed entries (each has a non-null end), oldest first. */
  entries: ClockEntry[];
  /** The currently open entry, if any. */
  openEntry: ClockEntry | null;
  /** Total worked time today in milliseconds (includes live open entry). */
  totalMs: number;
  /** Total worked time this week (Monday-based, entry's timezone) in milliseconds. */
  weekTotalMs: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** Parse an ISO 8601 timestamp (with offset) to a Date. */
export function parseIso(iso: string): Date {
  return new Date(iso);
}

/** Format the calendar date (YYYY-MM-DD) `now` falls on in `timeZone`. */
function todayInZone(timeZone: string, now: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** True when `dateStr` (an entry's `date`) falls on `now`'s calendar day in `timeZone`. */
export function isToday(dateStr: string, timeZone: string, now: Date): boolean {
  return dateStr === todayInZone(timeZone, now);
}

/** Return the Monday (YYYY-MM-DD) of the week containing `dateStr` (YYYY-MM-DD). */
function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = (date.getUTCDay() + 6) % 7; // 0 = Monday
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

/**
 * True when `dateStr` (an entry's `date`) falls in the current week
 * (Monday through today) in `timeZone`.
 */
export function isInCurrentWeek(
  dateStr: string,
  timeZone: string,
  now: Date,
): boolean {
  const today = todayInZone(timeZone, now);
  return dateStr >= mondayOf(today) && dateStr <= today;
}

/**
 * Classify raw clock entries into a today's summary.
 *
 * "Today" is computed per-entry in the entry's own timezone, so midnight
 * rollover in that zone is handled correctly even if the host is elsewhere.
 */
export function summarizeToday(entries: ClockEntry[], now: Date): TodaySummary {
  const openEntry = entries.find((e) => e.end === null) ?? null;

  const todays = entries.filter(
    (e) => e.end !== null && isToday(e.date, e.timezone, now),
  );
  todays.sort(
    (a, b) => parseIso(a.start).getTime() - parseIso(b.start).getTime(),
  );

  let weekTotalMs = entries
    .filter((e) => e.end !== null && isInCurrentWeek(e.date, e.timezone, now))
    .reduce((sum, e) => sum + e.hours * HOUR_MS, 0);

  let totalMs = todays.reduce((sum, e) => sum + e.hours * HOUR_MS, 0);
  if (openEntry) {
    const liveMs = now.getTime() - parseIso(openEntry.start).getTime();
    if (liveMs > 0) totalMs += liveMs;
    // The open (live) entry only counts toward the week while its date
    // is still inside the current week.
    if (
      liveMs > 0 &&
      isInCurrentWeek(openEntry.date, openEntry.timezone, now)
    ) {
      weekTotalMs += liveMs;
    }
  }

  return {
    clockedIn: openEntry !== null,
    clockedInSince: openEntry ? parseIso(openEntry.start) : null,
    entries: todays,
    openEntry,
    totalMs,
    weekTotalMs,
  };
}

/** Format a millisecond duration as "2h 25m" (omits hours when zero). */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / MINUTE_MS));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/** Format a duration expressed in hours (the entry `hours` field) as "2h 25m". */
export function formatHours(hours: number): string {
  return formatDuration(hours * HOUR_MS);
}

/** Format a Date as "HH:MM" in the local timezone. */
export function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** Format a Date as "HH:MM:SS" in the local timezone (for the live ticker). */
export function formatTimeSeconds(date: Date): string {
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${formatTime(date)}:${s}`;
}
