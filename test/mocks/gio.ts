/**
 * Minimal Gio stub for unit tests (vitest.config.ts aliases `gi://Gio`
 * here). Only implements the surface used by src/lib.
 */

export type FakeSchema = { id: string };
export type SchemaLookup = (
  id: string,
  recursive: boolean,
) => FakeSchema | null;

let schemaLookup: SchemaLookup = () => null;

/** Script what `SettingsSchemaSource.get_default().lookup()` returns. */
export function setSchemaLookup(fn: SchemaLookup): void {
  schemaLookup = fn;
}

class Cancellable {
  #cancelled = false;

  cancel(): void {
    this.#cancelled = true;
  }

  is_cancelled(): boolean {
    return this.#cancelled;
  }
}

class Settings {
  readonly schema: FakeSchema | null;

  constructor(opts?: { settings_schema?: FakeSchema | null }) {
    this.schema = opts?.settings_schema ?? null;
  }
}

const Gio = {
  Cancellable,
  Settings,
  SettingsSchemaSource: {
    get_default: () => ({
      lookup: (id: string, recursive: boolean) => schemaLookup(id, recursive),
    }),
  },
} as const;

export default Gio;
