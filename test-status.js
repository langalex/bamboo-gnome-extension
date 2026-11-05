// Sanity-check the compiled status.ts logic (from dist/status-test.js) under GJS.
// Classic GJS script (no ESM): the bundle's export statements are stripped and
// the functions are returned from a Function scope. status.ts has no runtime
// GI imports, so this exercises the real compiled logic standalone.

const Gio = imports.gi.Gio;

function readFile(path) {
  const [, contents] = Gio.File.new_for_path(path).load_contents(null);
  return new TextDecoder().decode(contents);
}

function loadBundle() {
  // Resolve relative to this script's own path (argv[0]).
  const dir = imports.system.programInvocationName.replace(/[^/]+$/, "");

  // Evaluate the standalone status-test bundle (built from src/lib/status.ts).
  // It has no runtime GI imports, so no stubbing is needed.
  let code = readFile(dir + "dist/status-test.js");

  // Strip esbuild's export statements (invalid inside new Function).
  code = code.replace(/export \{[\s\S]*?\};/g, "");

  const fn = new Function(
    code +
      "\n;return { summarizeToday, isToday, formatDuration, formatTime, formatTimeSeconds };",
  );
  return fn();
}

const {
  summarizeToday,
  isToday,
  formatDuration,
  formatTime,
  formatTimeSeconds,
} = loadBundle();

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  log(`${ok ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(actual)}`);
}

// --- fixtures ---------------------------------------------------------------
function entry(id, start, end, timezone, hours, date) {
  return {
    id,
    employeeId: 1,
    timesheetId: 1,
    date,
    start,
    end,
    timezone,
    hours,
    note: null,
    projectId: null,
    taskId: null,
    schedulingShiftId: null,
    startSource: "USER",
    endSource: end ? "USER" : null,
    clockedInBy: 1,
    clockedOutBy: end ? 1 : null,
    createdAt: start,
    updatedAt: end ?? start,
  };
}

const now = new Date("2026-03-17T16:00:00-06:00"); // Mar 17 16:00 MDT

// --- isToday ----------------------------------------------------------------
check("isToday same zone", isToday("2026-03-17", "America/Denver", now), true);
check(
  "isToday prev zone day",
  isToday("2026-03-16", "America/Denver", now),
  false,
);

// Midnight boundary: 2026-03-18 00:30 in Asia/Tokyo (UTC+9) == 2026-03-17 15:30 UTC
const tokyoNow = new Date("2026-03-17T15:30:00Z");
check(
  "isToday Tokyo midnight+30",
  isToday("2026-03-18", "Asia/Tokyo", tokyoNow),
  true,
);
check(
  "isToday Tokyo prev date",
  isToday("2026-03-17", "Asia/Tokyo", tokyoNow),
  false,
);

// --- summarizeToday ---------------------------------------------------------
const closedAm = entry(
  1,
  "2026-03-17T09:00:00-06:00",
  "2026-03-17T11:30:00-06:00",
  "America/Denver",
  2.5,
  "2026-03-17",
);
const closedPm = entry(
  2,
  "2026-03-17T13:00:00-06:00",
  "2026-03-17T15:00:00-06:00",
  "America/Denver",
  2.0,
  "2026-03-17",
);
const openNow = entry(
  3,
  "2026-03-17T15:05:00-06:00",
  null,
  "America/Denver",
  0,
  "2026-03-17",
);
const yesterday = entry(
  4,
  "2026-03-16T09:00:00-06:00",
  "2026-03-16T17:00:00-06:00",
  "America/Denver",
  8,
  "2026-03-16",
);

let s = summarizeToday([closedAm, closedPm, openNow, yesterday], now);
check("summary.clockedIn", s.clockedIn, true);
check(
  "summary.entries (closed today, oldest first)",
  s.entries.map((e) => e.id),
  [1, 2],
);
check(
  "summary.totalMs (2.5+2h closed + 55m live)",
  s.totalMs,
  (2.5 + 2) * 3600000 + 55 * 60000,
);
check("summary.openEntry id", s.openEntry?.id, 3);

// Clocked out, nothing today → zero total
const s2 = summarizeToday([yesterday], now);
check("summary2.clockedIn", s2.clockedIn, false);
check("summary2.entries", s2.entries, []);
check("summary2.totalMs", s2.totalMs, 0);

// Open entry started YESTERDAY still counts as clocked in (48h window case)
const openYesterday = entry(
  5,
  "2026-03-16T22:00:00-06:00",
  null,
  "America/Denver",
  0,
  "2026-03-16",
);
const s3 = summarizeToday([openYesterday, closedAm], now);
check("summary3.clockedIn (open since yesterday)", s3.clockedIn, true);
check(
  "summary3.clockedInSince",
  s3.clockedInSince?.toISOString(),
  "2026-03-17T04:00:00.000Z",
);
// 18h elapsed (Mar16 22:00 → Mar17 16:00) counts toward today's total
check(
  "summary3.totalMs includes overnight live",
  s3.totalMs,
  2.5 * 3600000 + 18 * 3600000,
);

// --- formatting -------------------------------------------------------------
check(
  "formatDuration 2h25m",
  formatDuration(2 * 3600000 + 25 * 60000),
  "2h 25m",
);
check("formatDuration 45m", formatDuration(45 * 60000), "45m");
check("formatDuration 3h", formatDuration(3 * 3600000), "3h");
check("formatDuration 0", formatDuration(0), "0m");
check("formatDuration negative", formatDuration(-5000), "0m");
// formatTime renders in the process-local timezone; compare against that.
const localTime = new Date("2026-03-17T09:05:00-06:00");
const localExpected = `${String(localTime.getHours()).padStart(2, "0")}:${String(localTime.getMinutes()).padStart(2, "0")}`;
check("formatTime (local tz)", formatTime(localTime), localExpected);

log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
