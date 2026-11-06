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
 * Read the extension's GSettings.
 *
 * The schema is compiled into `extensionsdir/schemas`, which is NOT part of
 * the default schema source (that only covers system-wide directories). Callers
 * pass the extension's schemas dir — `this.dir.get_child("schemas").get_path()`
 * on `Extension` / `ExtensionPreferences`. The default source stays chained as
 * a parent, so a schema installed system-wide (packaged extension) also
 * resolves, mirroring gnome-shell's own ExtensionBase.getSettings().
 */
export function loadSettings(schemasDir?: string | null): Gio.Settings {
  const defaultSource = Gio.SettingsSchemaSource.get_default();
  const schemaSource = schemasDir
    ? Gio.SettingsSchemaSource.new_from_directory(
        schemasDir,
        defaultSource,
        false,
      )
    : defaultSource;
  const schema = schemaSource?.lookup(SCHEMA_ID, true);
  if (!schema) {
    throw new Error(`GSettings schema ${SCHEMA_ID} not found`);
  }
  return new Gio.Settings({ settings_schema: schema });
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
