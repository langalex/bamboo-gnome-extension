import Gio from "gi://Gio";

/** Schema id; must match metadata.json `settings-schema` and the gschema.xml. */
export const SCHEMA_ID = "org.gnome.shell.extensions.bamboo-timesheet";

/** Keys bound in prefs.ts. */
export const SettingsKeys = {
  CompanyDomain: "company-domain",
  ApiKey: "api-key",
  EmployeeId: "employee-id",
  RefreshIntervalIn: "refresh-interval-in",
  RefreshIntervalOut: "refresh-interval-out",
} as const;

export type SettingsKey = (typeof SettingsKeys)[keyof typeof SettingsKeys];

export interface BambooSettings {
  companyDomain: string;
  apiKey: string;
  employeeId: number;
  refreshIntervalIn: number;
  refreshIntervalOut: number;
  configured: boolean;
}

/**
 * Read the extension's GSettings. The GNOME 51 extension loader resolves the
 * schema from `extensionsdir/schemas` (the dev-installed compiled schema);
 * pass `true` to force reading from the default schema source instead.
 */
export function loadSettings(forceDefault = false): Gio.Settings {
  const schemaSource = Gio.SettingsSchemaSource.get_default();
  const schema = schemaSource?.lookup(SCHEMA_ID, true);
  if (schema && !forceDefault) {
    return new Gio.Settings({ settings_schema: schema });
  }
  throw new Error(`GSettings schema ${SCHEMA_ID} not found`);
}

/** Read all settings into a plain object. */
export function getSettings(s: Gio.Settings): BambooSettings {
  const companyDomain = s.get_string(SettingsKeys.CompanyDomain);
  const apiKey = s.get_string(SettingsKeys.ApiKey);
  return {
    companyDomain,
    apiKey,
    employeeId: s.get_int(SettingsKeys.EmployeeId),
    refreshIntervalIn: s.get_int(SettingsKeys.RefreshIntervalIn),
    refreshIntervalOut: s.get_int(SettingsKeys.RefreshIntervalOut),
    configured: companyDomain.trim() !== "" && apiKey.trim() !== "",
  };
}
