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

let schemaDirLookup: ((dir: string) => SchemaLookup | null) | null = null;

/**
 * Script what `SettingsSchemaSource.new_from_directory(dir)` yields: the
 * callback returns the schema lookup for `dir`, or null for an empty dir.
 */
export function setSchemaDirLookup(
  fn: ((dir: string) => SchemaLookup | null) | null,
): void {
  schemaDirLookup = fn;
}

class Cancellable {
  #cancelled = false;
  #handlers = new Map<number, () => void>();
  #nextId = 1;

  cancel(): void {
    this.#cancelled = true;
    for (const handler of this.#handlers.values()) handler();
    this.#handlers.clear();
  }

  /**
   * Mirrors the introspected g_cancellable_connect: Gio.Cancellable shadows
   * GObject.connect, so the handler is the only argument. GObject-style
   * ("cancelled", handler) throws — the real GJS runtime does too.
   */
  connect(handler: () => void): number {
    if (typeof handler !== "function") {
      throw new TypeError(
        "Gio.Cancellable.connect takes the handler as its only argument",
      );
    }
    const id = this.#nextId++;
    this.#handlers.set(id, handler);
    return id;
  }

  disconnect(id: number): void {
    this.#handlers.delete(id);
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
  // GJS private helper used by src/lib/bamboohr.ts at module scope; the
  // stubbed session methods are already promise-based, so this is a no-op.
  _promisify(): void {},
  SettingsSchemaSource: {
    get_default: () => ({
      lookup: (id: string, recursive: boolean) => schemaLookup(id, recursive),
    }),
    // Mirrors GI source chaining: schemas dir first, then the parent source
    // (when lookup is called with recursive=true).
    new_from_directory: (dir: string, _parent: unknown, _trusted: boolean) => ({
      lookup: (id: string, recursive: boolean): FakeSchema | null => {
        const dirHit = schemaDirLookup?.(dir)?.(id, recursive) ?? null;
        if (dirHit) return dirHit;
        return recursive ? schemaLookup(id, recursive) : null;
      },
    }),
  },
} as const;

export default Gio;
