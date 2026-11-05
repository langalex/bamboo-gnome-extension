/**
 * Shared types for the BambooHR REST API (Time Tracking v1).
 * Shapes verified against https://documentation.bamboohr.com/reference/clock-in
 * and .../list-clock-entries.
 */

/** A time-tracking clock entry (open = `end` is null). */
export interface ClockEntry {
  id: number;
  employeeId: number;
  timesheetId: number;
  /** Calendar date the entry is attributed to, in the entry's timezone (YYYY-MM-DD). */
  date: string;
  /** Clock-in timestamp, ISO 8601 with the offset of the entry's timezone. */
  start: string;
  /** Clock-out timestamp. Null while the employee is actively clocked in. */
  end: string | null;
  /** IANA timezone name under which start/end were recorded. */
  timezone: string;
  /** Computed elapsed hours between start and end. Zero while the entry is open. */
  hours: number;
  note: string | null;
  projectId: number | null;
  taskId: number | null;
  schedulingShiftId: string | null;
  startSource: 'USER' | 'SYSTEM' | null;
  endSource: 'USER' | 'SYSTEM' | null;
  clockedInBy: number | null;
  clockedOutBy: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Pagination envelope for list endpoints. */
export interface PaginationMeta {
  totalItems: number;
  totalPages: number;
  page: number;
  pageSize: number;
}

/** Response of GET /api/v1/time-tracking/clock-entries. */
export interface ClockEntriesResponse {
  data: ClockEntry[];
  meta: PaginationMeta;
}

/** Minimal shape of GET /api/v1/employees/{id} (employee id `0` = caller). */
export interface EmployeeRecord {
  id: string | number;
  [key: string]: unknown;
}

/** Request body for POST /api/v1/time-tracking/clock-ins. */
export interface ClockInRequest {
  employeeId: number;
  /** IANA timezone name, e.g. "America/Denver". */
  timezone: string;
}

/** Request body for POST /api/v1/time-tracking/clock-outs. */
export interface ClockOutRequest {
  employeeId: number;
}

/** BambooHR problem-details error body (RFC 7807-ish). */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  code?: string;
  fields?: Record<string, string>;
}
