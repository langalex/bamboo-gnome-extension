import { describe, expect, it } from "vitest";
import type { ClockEntry } from "../src/lib/types.js";
import {
  formatDuration,
  formatHours,
  formatTime,
  formatTimeSeconds,
  isToday,
  parseIso,
  summarizeToday,
} from "../src/lib/status.js";

/** Build a ClockEntry; `date` defaults to the local calendar date in `start`. */
function entry(
  id: number,
  start: string,
  end: string | null,
  opts: Partial<Pick<ClockEntry, "date" | "timezone" | "hours">> = {},
): ClockEntry {
  return {
    id,
    employeeId: 1,
    timesheetId: 1,
    date: opts.date ?? start.slice(0, 10),
    start,
    end,
    timezone: opts.timezone ?? "America/Denver",
    hours: opts.hours ?? 0,
    note: null,
    projectId: null,
    taskId: null,
    schedulingShiftId: null,
    startSource: "USER",
    endSource: end === null ? null : "USER",
    clockedInBy: 1,
    clockedOutBy: end === null ? null : 1,
    createdAt: start,
    updatedAt: end ?? start,
  };
}

describe("parseIso", () => {
  it("parses an ISO timestamp with offset", () => {
    const parsed = parseIso("2026-03-17T09:00:00-06:00");
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed.getTime()).toBe(Date.parse("2026-03-17T09:00:00-06:00"));
    expect(parsed.toISOString()).toBe("2026-03-17T15:00:00.000Z");
  });
});

describe("isToday", () => {
  const now = new Date("2026-03-17T16:00:00-06:00"); // Mar 17, 22:00 UTC

  it("accepts the same calendar day in the entry's timezone", () => {
    expect(isToday("2026-03-17", "America/Denver", now)).toBe(true);
  });

  it("rejects the previous and next calendar day", () => {
    expect(isToday("2026-03-16", "America/Denver", now)).toBe(false);
    expect(isToday("2026-03-18", "America/Denver", now)).toBe(false);
  });

  it("follows the entry's timezone, not the host's", () => {
    // 2026-03-17 15:30 UTC is already 2026-03-18 00:30 in Tokyo.
    const tokyoNow = new Date("2026-03-17T15:30:00Z");
    expect(isToday("2026-03-18", "Asia/Tokyo", tokyoNow)).toBe(true);
    expect(isToday("2026-03-17", "Asia/Tokyo", tokyoNow)).toBe(false);
    // The same instant is still Mar 17 in UTC.
    expect(isToday("2026-03-17", "UTC", tokyoNow)).toBe(true);
  });
});

describe("summarizeToday", () => {
  // Mar 17, 16:00 MDT = 22:00 UTC.
  const now = new Date("2026-03-17T16:00:00-06:00");

  it("summarizes a typical day with an open entry", () => {
    const closedAm = entry(
      1,
      "2026-03-17T09:00:00-06:00",
      "2026-03-17T11:30:00-06:00",
      { hours: 2.5 },
    );
    const closedPm = entry(
      2,
      "2026-03-17T13:00:00-06:00",
      "2026-03-17T15:00:00-06:00",
      { hours: 2.0 },
    );
    const openNow = entry(3, "2026-03-17T15:05:00-06:00", null);
    const yesterday = entry(
      4,
      "2026-03-16T09:00:00-06:00",
      "2026-03-16T17:00:00-06:00",
      { hours: 8 },
    );

    const s = summarizeToday([closedPm, openNow, yesterday, closedAm], now);

    expect(s.clockedIn).toBe(true);
    expect(s.openEntry?.id).toBe(3);
    expect(s.clockedInSince?.toISOString()).toBe("2026-03-17T21:05:00.000Z");
    // Only closed entries from today, sorted oldest first; the open entry and
    // yesterday's entries are excluded.
    expect(s.entries.map((e) => e.id)).toEqual([1, 2]);
    // 2.5h + 2h closed + 55m live.
    expect(s.totalMs).toBe((2.5 + 2) * 3_600_000 + 55 * 60_000);
    // Week (Mon Mar 16 – Sun Mar 22): yesterday's 8h + today's 4.5h + 55m live.
    expect(s.weekTotalMs).toBe(
      8 * 3_600_000 + (2.5 + 2) * 3_600_000 + 55 * 60_000,
    );
  });

  it("sorts today's entries by start time regardless of input order", () => {
    const later = entry(
      2,
      "2026-03-17T13:00:00-06:00",
      "2026-03-17T15:00:00-06:00",
      { hours: 2 },
    );
    const earlier = entry(
      1,
      "2026-03-17T09:00:00-06:00",
      "2026-03-17T11:30:00-06:00",
      { hours: 2.5 },
    );

    const s = summarizeToday([later, earlier], now);

    expect(s.entries.map((e) => e.id)).toEqual([1, 2]);
  });

  it("handles a clocked-in day with no closed entries", () => {
    const openNow = entry(3, "2026-03-17T15:05:00-06:00", null);

    const s = summarizeToday([openNow], now);

    expect(s.clockedIn).toBe(true);
    expect(s.entries).toEqual([]);
    expect(s.totalMs).toBe(55 * 60_000);
  });

  it("returns zeros when nothing happened today", () => {
    const yesterday = entry(
      4,
      "2026-03-16T09:00:00-06:00",
      "2026-03-16T17:00:00-06:00",
      { hours: 8 },
    );

    const s = summarizeToday([yesterday], now);

    expect(s.clockedIn).toBe(false);
    expect(s.clockedInSince).toBeNull();
    expect(s.openEntry).toBeNull();
    expect(s.entries).toEqual([]);
    expect(s.totalMs).toBe(0);
  });

  it("counts an overnight open entry toward today's total", () => {
    // Open since Mar 16 22:00 MDT → 18h elapsed by now (Mar 17 16:00).
    const openYesterday = entry(5, "2026-03-16T22:00:00-06:00", null);
    const closedAm = entry(
      1,
      "2026-03-17T09:00:00-06:00",
      "2026-03-17T11:30:00-06:00",
      { hours: 2.5 },
    );

    const s = summarizeToday([openYesterday, closedAm], now);

    expect(s.clockedIn).toBe(true);
    expect(s.clockedInSince?.toISOString()).toBe("2026-03-17T04:00:00.000Z");
    expect(s.totalMs).toBe(2.5 * 3_600_000 + 18 * 3_600_000);
  });

  it("ignores live time from an open entry that starts in the future", () => {
    const closedAm = entry(
      1,
      "2026-03-17T09:00:00-06:00",
      "2026-03-17T11:30:00-06:00",
      { hours: 2.5 },
    );
    const futureOpen = entry(6, "2026-03-17T17:00:00-06:00", null);

    const s = summarizeToday([closedAm, futureOpen], now);

    expect(s.clockedIn).toBe(true);
    expect(s.totalMs).toBe(2.5 * 3_600_000);
  });

  it("includes entries from other timezones when that zone's date is today", () => {
    // 2026-03-17 15:30 UTC is 2026-03-18 00:30 in Tokyo, so an entry dated
    // Mar 18 in Asia/Tokyo belongs in "today" even though the host is on Mar 17.
    const tokyoNow = new Date("2026-03-17T15:30:00Z");
    const tokyoEntry = entry(
      7,
      "2026-03-18T00:30:00+09:00",
      "2026-03-18T01:30:00+09:00",
      {
        date: "2026-03-18",
        timezone: "Asia/Tokyo",
        hours: 1,
      },
    );

    const s = summarizeToday([tokyoEntry], tokyoNow);

    expect(s.entries.map((e) => e.id)).toEqual([7]);
    expect(s.totalMs).toBe(3_600_000);
  });

  it("keeps only the first open entry when several are open", () => {
    const open1 = entry(8, "2026-03-17T10:00:00-06:00", null);
    const open2 = entry(9, "2026-03-17T11:00:00-06:00", null);

    const s = summarizeToday([open1, open2], now);

    expect(s.clockedIn).toBe(true);
    expect(s.openEntry?.id).toBe(8);
  });

  it("counts week totals from Monday, excluding last week's entries", () => {
    // now is Tuesday Mar 17, 2026; the week starts Monday Mar 16.
    const lastSunday = entry(
      10,
      "2026-03-15T09:00:00-06:00",
      "2026-03-15T17:00:00-06:00",
      { hours: 8 },
    );
    const monday = entry(
      11,
      "2026-03-16T09:00:00-06:00",
      "2026-03-16T17:00:00-06:00",
      { hours: 8 },
    );
    const tuesday = entry(
      12,
      "2026-03-17T09:00:00-06:00",
      "2026-03-17T11:30:00-06:00",
      { hours: 2.5 },
    );

    const s = summarizeToday([lastSunday, monday, tuesday], now);

    expect(s.totalMs).toBe(2.5 * 3_600_000);
    expect(s.weekTotalMs).toBe(10.5 * 3_600_000);
  });

  it("excludes an open entry from the week total when its date is last week", () => {
    // Open since Sunday Mar 15 22:00, still running Tuesday Mar 16:00.
    const openSinceSunday = entry(13, "2026-03-15T22:00:00-06:00", null);

    const s = summarizeToday([openSinceSunday], now);

    expect(s.totalMs).toBe(42 * 3_600_000);
    expect(s.weekTotalMs).toBe(0);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0m"],
    [-5000, "0m"],
    [45 * 60_000, "45m"],
    [60 * 60_000, "1h"],
    [125 * 60_000, "2h 5m"],
    [2 * 3_600_000 + 25 * 60_000, "2h 25m"],
    [3 * 3_600_000, "3h"],
    // Rounds to the nearest minute.
    [25.75 * 60_000, "26m"],
  ])("formats %p ms as %p", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("formatHours", () => {
  it.each([
    [0, "0m"],
    [0.75, "45m"],
    [1, "1h"],
    [2.4666666667, "2h 28m"],
    [8, "8h"],
  ])("formats %p hours as %p", (hours, expected) => {
    expect(formatHours(hours)).toBe(expected);
  });
});

describe("formatTime", () => {
  it("formats as zero-padded HH:MM", () => {
    // Tests run with TZ=UTC (see vitest.config.ts).
    expect(formatTime(new Date("2026-03-17T09:05:00Z"))).toBe("09:05");
    expect(formatTime(new Date("2026-03-17T05:03:00Z"))).toBe("05:03");
  });
});

describe("formatTimeSeconds", () => {
  it("appends zero-padded seconds to HH:MM", () => {
    expect(formatTimeSeconds(new Date("2026-03-17T09:05:07Z"))).toBe(
      "09:05:07",
    );
    expect(formatTimeSeconds(new Date("2026-03-17T09:05:00Z"))).toBe(
      "09:05:00",
    );
  });
});
