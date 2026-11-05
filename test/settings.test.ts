import { beforeEach, describe, expect, it } from "vitest";
import { getSettings, loadSettings, SettingsKeys } from "../src/lib/settings.js";
import { setSchemaLookup } from "./mocks/gio.js";

/** Duck-typed Gio.Settings stand-in backed by a plain map. */
function fakeSettings(values: Partial<Record<string, string | number>>) {
  return {
    get_string: (key: string) => String(values[key] ?? ""),
    get_int: (key: string) => Number(values[key] ?? 0),
  } as unknown as Parameters<typeof getSettings>[0];
}

beforeEach(() => {
  setSchemaLookup(() => null);
});

describe("getSettings", () => {
  it("reads every key into a plain object", () => {
    const s = getSettings(
      fakeSettings({
        [SettingsKeys.CompanyDomain]: "acme",
        [SettingsKeys.ApiKey]: "secret",
        [SettingsKeys.EmployeeId]: 12,
        [SettingsKeys.RefreshIntervalIn]: 30,
        [SettingsKeys.RefreshIntervalOut]: 300,
      }),
    );

    expect(s).toEqual({
      companyDomain: "acme",
      apiKey: "secret",
      employeeId: 12,
      refreshIntervalIn: 30,
      refreshIntervalOut: 300,
      configured: true,
    });
  });

  it("reports configured=false when the domain is missing", () => {
    const s = getSettings(
      fakeSettings({ [SettingsKeys.ApiKey]: "secret" }),
    );
    expect(s.configured).toBe(false);
  });

  it("reports configured=false when the API key is blank", () => {
    const s = getSettings(
      fakeSettings({
        [SettingsKeys.CompanyDomain]: "acme",
        [SettingsKeys.ApiKey]: "   ",
      }),
    );
    expect(s.configured).toBe(false);
  });

  it("treats whitespace-padded values as configured", () => {
    const s = getSettings(
      fakeSettings({
        [SettingsKeys.CompanyDomain]: " acme ",
        [SettingsKeys.ApiKey]: " secret ",
      }),
    );
    expect(s.configured).toBe(true);
  });
});

describe("loadSettings", () => {
  const SCHEMA_ID = "org.gnome.shell.extensions.bamboo-timesheet";

  it("throws a clear error when the schema is not installed", () => {
    setSchemaLookup(() => null);

    expect(() => loadSettings()).toThrow(SCHEMA_ID);
  });

  it("returns a Settings object bound to the looked-up schema", () => {
    const schema = { id: SCHEMA_ID };
    setSchemaLookup((id) => (id === SCHEMA_ID ? schema : null));

    const settings = loadSettings();

    expect(settings.schema).toBe(schema);
  });

  it("forceDefault still requires the schema to be installed", () => {
    expect(() => loadSettings(true)).toThrow(SCHEMA_ID);
  });
});
