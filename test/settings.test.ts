import { beforeEach, describe, expect, it } from "vitest";
import {
  getSettings,
  loadSettings,
  SettingsKeys,
} from "../src/lib/settings.js";
import { setSchemaDirLookup, setSchemaLookup } from "./mocks/gio.js";

/** Duck-typed Gio.Settings stand-in backed by a plain map. */
function fakeSettings(values: Partial<Record<string, string | number>>) {
  return {
    get_string: (key: string) => String(values[key] ?? ""),
    get_int: (key: string) => Number(values[key] ?? 0),
  } as unknown as Parameters<typeof getSettings>[0];
}

beforeEach(() => {
  setSchemaLookup(() => null);
  setSchemaDirLookup(() => null);
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
    const s = getSettings(fakeSettings({ [SettingsKeys.ApiKey]: "secret" }));
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
    expect(() => loadSettings()).toThrow(SCHEMA_ID);
  });

  it("returns a Settings object bound to the default-source schema", () => {
    const schema = { id: SCHEMA_ID };
    setSchemaLookup((id) => (id === SCHEMA_ID ? schema : null));

    const settings = loadSettings();

    expect(settings.schema).toBe(schema);
  });

  it("looks the schema up in the given schemas directory", () => {
    const schema = { id: SCHEMA_ID };
    const seenDirs: string[] = [];
    setSchemaDirLookup((dir) => {
      seenDirs.push(dir);
      return (id) => (id === SCHEMA_ID ? schema : null);
    });

    const settings = loadSettings("/ext/schemas");

    expect(seenDirs).toEqual(["/ext/schemas"]);
    expect(settings.schema).toBe(schema);
  });

  it("falls back to the default source when the directory has no schema", () => {
    const schema = { id: SCHEMA_ID };
    setSchemaDirLookup(() => null);
    setSchemaLookup((id) => (id === SCHEMA_ID ? schema : null));

    const settings = loadSettings("/ext/schemas");

    expect(settings.schema).toBe(schema);
  });

  it("throws when neither the directory nor the default source has it", () => {
    expect(() => loadSettings("/ext/schemas")).toThrow(SCHEMA_ID);
  });
});
