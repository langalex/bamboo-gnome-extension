import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Soup from "gi://Soup?version=3.0";
import type {
  ClockEntriesResponse,
  ClockEntry,
  ClockInRequest,
  ClockOutRequest,
  EmployeeRecord,
} from "./types.js";

/** Thrown for HTTP-level failures; carries the status code for classification. */
export class BambooApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body = "") {
    super(message);
    this.name = "BambooApiError";
    this.status = status;
    this.body = body;
  }
}

export interface BambooClientOptions {
  /** Subdomain before .bamboohr.com, e.g. "mycompany". */
  companyDomain: string;
  /** BambooHR API key (sent as HTTP Basic auth username). */
  apiKey: string;
  /** HTTP(S) request timeout in seconds. */
  timeoutSeconds?: number;
}

const DEFAULT_TIMEOUT_SECONDS = 10;

/** Build the `Authorization: Basic` header value for the BambooHR API key. */
export function basicAuthHeader(apiKey: string): string {
  // Username = API key, password = "x" (BambooHR's documented convention).
  const raw = `${apiKey}:x`;
  const bytes = new TextEncoder().encode(raw);
  return `Basic ${GLib.base64_encode(bytes)}`;
}

/**
 * Typed client for the BambooHR REST API.
 *
 * Uses Soup 3 (GJS-provided) with a shared session. All methods are async and
 * return parsed JSON; HTTP errors surface as {@link BambooApiError}.
 */
export class BambooClient {
  readonly #session: Soup.Session;
  readonly #baseUrl: string;
  readonly #authHeader: string;
  readonly #timeoutMs: number;

  constructor(opts: BambooClientOptions) {
    if (!opts.companyDomain.trim() || !opts.apiKey.trim()) {
      throw new Error("BambooClient requires companyDomain and apiKey");
    }
    this.#baseUrl = `https://${opts.companyDomain.trim()}.bamboohr.com/api/v1`;
    this.#authHeader = basicAuthHeader(opts.apiKey);
    this.#timeoutMs = (opts.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
    this.#session = new Soup.Session();
  }

  /** GET /api/v1/employees/0 — resolves to the API key's owner. */
  async getSelf(): Promise<EmployeeRecord> {
    return this.#requestJson("GET", "/employees/0");
  }

  /**
   * GET /api/v1/time-tracking/clock-entries for the given employee and
   * timestamp window, sorted newest-first.
   */
  async listClockEntries(
    employeeId: number,
    from: Date,
    to: Date,
  ): Promise<ClockEntriesResponse> {
    const filter =
      `employeeId eq ${employeeId} and ` +
      `start ge ${from.toISOString()} and start le ${to.toISOString()}`;
    const qs =
      `filter=${encodeURIComponent(filter)}` +
      `&sort=${encodeURIComponent("start desc")}` +
      `&pageSize=200`;
    return this.#requestJson("GET", `/time-tracking/clock-entries?${qs}`);
  }

  /** POST /api/v1/time-tracking/clock-ins — returns the new open entry. */
  async clockIn(req: ClockInRequest): Promise<ClockEntry> {
    return this.#requestJson("POST", "/time-tracking/clock-ins", req);
  }

  /** POST /api/v1/time-tracking/clock-outs — returns the closed entry. */
  async clockOut(req: ClockOutRequest): Promise<ClockEntry> {
    return this.#requestJson("POST", "/time-tracking/clock-outs", req);
  }

  async #requestJson<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const msg = Soup.Message.new(method, `${this.#baseUrl}${path}`);
    msg.get_request_headers().append("Authorization", this.#authHeader);
    msg.get_request_headers().append("Accept", "application/json");

    if (body !== undefined) {
      const json = JSON.stringify(body);
      msg.set_request_body_from_bytes(
        "application/json",
        new GLib.Bytes(new TextEncoder().encode(json)),
      );
    }

    const cancellable = new Gio.Cancellable();
    const timer = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      this.#timeoutMs,
      () => {
        cancellable.cancel();
        return GLib.SOURCE_REMOVE;
      },
    );

    let bytes: GLib.Bytes;
    try {
      bytes = await this.#session.send_and_read_async(
        msg,
        GLib.PRIORITY_DEFAULT,
        cancellable,
      );
    } catch (err) {
      if (cancellable.is_cancelled()) {
        throw new BambooApiError(
          `Request timed out after ${this.#timeoutMs / 1000}s`,
          0,
        );
      }
      throw new BambooApiError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        0,
      );
    } finally {
      GLib.source_remove(timer);
    }

    const status = msg.get_status();
    const text = bytes.toArray()
      ? new TextDecoder().decode(bytes.toArray())
      : "";

    if (status < 200 || status >= 300) {
      throw new BambooApiError(this.#describeError(status, text), status, text);
    }
    if (!text.trim()) return undefined as T;
    return JSON.parse(text) as T;
  }

  /** Human-readable message for non-2xx statuses. */
  #describeError(status: number, body: string): string {
    let detail = "";
    try {
      const parsed = JSON.parse(body) as { detail?: string; title?: string };
      detail = parsed.detail ?? parsed.title ?? "";
    } catch {
      detail = body.slice(0, 200);
    }
    const base = this.#statusText(status);
    return detail ? `${base}: ${detail}` : base;
  }

  #statusText(status: number): string {
    switch (status) {
      case 401:
        return "Unauthorized: check your API key";
      case 403:
        return "Forbidden: the API key is disabled or lacks permission";
      case 404:
        return "Not found (no open entry?)";
      case 409:
        return "Conflict: already clocked in/out";
      case 422:
        return "Validation error (timezone or configuration issue)";
      case 429:
        return "Rate limited: try again shortly";
      default:
        return `HTTP ${status}`;
    }
  }
}
