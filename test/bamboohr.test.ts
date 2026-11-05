import { beforeEach, describe, expect, it } from "vitest";
import Gio from "gi://Gio";
import {
  BambooApiError,
  BambooClient,
  basicAuthHeader,
} from "../src/lib/bamboohr.js";
import { Message, respondWith, setSoupResponder } from "./mocks/soup.js";

const client = () =>
  new BambooClient({ companyDomain: "acme", apiKey: "key-1" });

describe("basicAuthHeader", () => {
  it("base64-encodes '<apiKey>:x' with a Basic prefix", () => {
    // base64("abc123:x") — BambooHR convention: key as username, "x" as password.
    expect(basicAuthHeader("abc123")).toBe("Basic YWJjMTIzOng=");
  });

  it("matches Node's own base64 of the UTF-8 payload", () => {
    expect(basicAuthHeader("k€y")).toBe(
      `Basic ${Buffer.from("k€y:x", "utf8").toString("base64")}`,
    );
  });
});

describe("BambooClient constructor", () => {
  it("rejects blank company domains and API keys", () => {
    expect(
      () => new BambooClient({ companyDomain: "  ", apiKey: "k" }),
    ).toThrow(/requires companyDomain and apiKey/);
    expect(
      () => new BambooClient({ companyDomain: "acme", apiKey: "" }),
    ).toThrow(/requires companyDomain and apiKey/);
  });

  it("trims the company domain when building the base URL", async () => {
    respondWith(200, "{}");
    await new BambooClient({
      companyDomain: "  padded  ",
      apiKey: "k",
    }).getSelf();
    expect(Message.last?.url).toBe(
      "https://padded.bamboohr.com/api/v1/employees/0",
    );
  });
});

describe("BambooClient requests", () => {
  beforeEach(() => {
    setSoupResponder(() => ({ status: 200, body: "{}" }));
  });

  it("getSelf sends GET with auth + accept headers and parses JSON", async () => {
    respondWith(200, JSON.stringify({ id: "12", firstName: "Alex" }));

    const me = await client().getSelf();

    expect(me).toEqual({ id: "12", firstName: "Alex" });
    const msg = Message.last;
    expect(msg?.method).toBe("GET");
    expect(msg?.url).toBe("https://acme.bamboohr.com/api/v1/employees/0");
    expect(msg?.requestHeaders.get("Authorization")).toBe(
      basicAuthHeader("key-1"),
    );
    expect(msg?.requestHeaders.get("Accept")).toBe("application/json");
  });

  it("listClockEntries builds the filter/sort/pageSize query string", async () => {
    respondWith(200, JSON.stringify({ data: [], meta: {} }));
    const from = new Date("2026-03-16T06:00:00.000Z");
    const to = new Date("2026-03-18T05:59:59.999Z");

    await client().listClockEntries(42, from, to);

    const url = Message.last?.url ?? "";
    expect(
      url.startsWith(
        "https://acme.bamboohr.com/api/v1/time-tracking/clock-entries?",
      ),
    ).toBe(true);

    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("filter")).toBe(
      `employeeId eq 42 and start ge ${from.toISOString()} and start le ${to.toISOString()}`,
    );
    expect(params.get("sort")).toBe("start desc");
    expect(params.get("pageSize")).toBe("200");
  });

  it("clockIn sends the JSON body with the right content type", async () => {
    respondWith(201, JSON.stringify({ id: 99 }));

    const created = await client().clockIn({
      employeeId: 7,
      timezone: "America/Denver",
    });

    expect(created).toEqual({ id: 99 });
    const msg = Message.last;
    expect(msg?.method).toBe("POST");
    expect(msg?.url).toBe(
      "https://acme.bamboohr.com/api/v1/time-tracking/clock-ins",
    );
    expect(msg?.requestBody).toEqual({
      contentType: "application/json",
      text: JSON.stringify({ employeeId: 7, timezone: "America/Denver" }),
    });
  });

  it("resolves to undefined for an empty 2xx body", async () => {
    respondWith(204, "");

    const result = await client().getSelf();

    expect(result).toBeUndefined();
  });
});

describe("BambooClient error handling", () => {
  beforeEach(() => {
    setSoupResponder(() => ({ status: 200, body: "{}" }));
  });

  it("raises BambooApiError with a friendly 401 message and raw body", async () => {
    respondWith(401, JSON.stringify({ detail: "bad key" }));

    const err = await client()
      .getSelf()
      .catch((e) => e);

    expect(err).toBeInstanceOf(BambooApiError);
    expect(err.status).toBe(401);
    expect(err.body).toBe('{"detail":"bad key"}');
    expect(err.message).toBe("Unauthorized: check your API key: bad key");
  });

  it("falls back to the title field for problem-details bodies", async () => {
    respondWith(409, JSON.stringify({ title: "already clocked in" }));

    const err = await client()
      .clockOut({ employeeId: 7 })
      .catch((e) => e);

    expect(err).toBeInstanceOf(BambooApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe(
      "Conflict: already clocked in/out: already clocked in",
    );
  });

  it("summarizes known statuses without a detail body", async () => {
    respondWith(429, "");

    const err = await client()
      .getSelf()
      .catch((e) => e);

    expect(err).toBeInstanceOf(BambooApiError);
    expect(err.message).toBe("Rate limited: try again shortly");
  });

  it("includes unknown statuses and raw bodies in the message", async () => {
    respondWith(503, "upstream exploded");

    const err = await client()
      .getSelf()
      .catch((e) => e);

    expect(err).toBeInstanceOf(BambooApiError);
    expect(err.status).toBe(503);
    expect(err.message).toBe("HTTP 503: upstream exploded");
  });

  it("wraps network failures as status-0 BambooApiError", async () => {
    setSoupResponder(() => {
      throw new Error("ECONNREFUSED");
    });

    const err = await client()
      .getSelf()
      .catch((e) => e);

    expect(err).toBeInstanceOf(BambooApiError);
    expect(err.status).toBe(0);
    expect(err.message).toContain("Network error: ECONNREFUSED");
  });
});

describe("BambooClient cancellation", () => {
  beforeEach(() => {
    setSoupResponder(() => ({ status: 200, body: "{}" }));
  });

  it("fails fast when the parent cancellable is already cancelled", async () => {
    const parent = new Gio.Cancellable();
    parent.cancel();

    const err = await client()
      .getSelf(parent)
      .catch((e) => e);

    expect(err).toBeInstanceOf(BambooApiError);
    expect(err.status).toBe(0);
    expect(err.message).toBe("Request cancelled");
  });

  it("cancels the in-flight request when the parent cancellable fires", async () => {
    const parent = new Gio.Cancellable();
    const pending = client().getSelf(parent);
    // Cancel before the stubbed send resolves — mirrors a newer refresh
    // superseding an in-flight one.
    parent.cancel();

    const err = await pending.catch((e) => e);

    expect(err).toBeInstanceOf(BambooApiError);
    expect(err.status).toBe(0);
    expect(err.message).toBe("Request cancelled");
  });
});
