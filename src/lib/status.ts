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
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** Parse an ISO 8601 timestamp (with offset) to a Date. */
export function parseIso(iso: string): Date {
  return new Date(iso);
}

/** True when `dateStr` (an entry's `date`) falls on `now`'s calendar day in `timeZone`. */
export function isToday(dateStr: string, timeZone: string, now: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return dateStr === `${parts.year}-${parts.month}-${parts.day}`;
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

  let totalMs = todays.reduce((sum, e) => sum + e.hours * HOUR_MS, 0);
  if (openEntry) {
    const liveMs = now.getTime() - parseIso(openEntry.start).getTime();
    if (liveMs > 0) totalMs += liveMs;
  }

  return {
    clockedIn: openEntry !== null,
    clockedInSince: openEntry ? parseIso(openEntry.start) : null,
    entries: todays,
    openEntry,
    totalMs,
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
