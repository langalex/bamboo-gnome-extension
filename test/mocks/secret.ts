/**
 * Minimal Secret stub for unit tests (vitest.config.ts aliases `gi://Secret`
 * here). Only implements the surface used by src/lib/secrets.ts.
 */

/** An item as recorded by the fake keyring. */
export interface FakeSecretItem {
  schemaName: string;
  attributes: Record<string, string>;
  collection: string | null;
  label: string;
  password: string;
}

/** Scriptable fake-keyring state; call resetSecrets() between tests. */
export const fakeSecretState = {
  items: new Map<string, FakeSecretItem>(),
  /** When set, every keyring operation rejects with this error. */
  error: null as Error | null,
  /** When set, lookups return this instead of the stored item's value. */
  lookupResult: undefined as string | null | undefined,
};

export function resetSecrets(): void {
  fakeSecretState.items.clear();
  fakeSecretState.error = null;
  fakeSecretState.lookupResult = undefined;
}

function itemKey(
  schemaName: string,
  attributes: Record<string, string>,
): string {
  return `${schemaName}::${JSON.stringify(attributes)}`;
}

interface FakeSchema {
  name: string;
  attributes: Record<string, unknown>;
}

const Schema = {
  new(
    name: string,
    _flags: unknown,
    attributeNamesAndTypes: Record<string, unknown>,
  ): FakeSchema {
    return { name, attributes: attributeNamesAndTypes };
  },
};

type Attributes = { [key: string]: string };

const Secret = {
  Schema,
  SchemaAttributeType: { STRING: 0 },
  SchemaFlags: { NONE: 0 },
  COLLECTION_DEFAULT: "default",

  async password_lookup(
    schema: FakeSchema,
    attributes: Attributes,
    _cancellable: unknown,
  ): Promise<string | null> {
    if (fakeSecretState.error) throw fakeSecretState.error;
    if (fakeSecretState.lookupResult !== undefined) {
      return fakeSecretState.lookupResult;
    }
    const item = fakeSecretState.items.get(itemKey(schema.name, attributes));
    return item?.password ?? null;
  },

  async password_store(
    schema: FakeSchema,
    attributes: Attributes,
    collection: string | null,
    label: string,
    password: string,
    _cancellable: unknown,
  ): Promise<boolean> {
    if (fakeSecretState.error) throw fakeSecretState.error;
    fakeSecretState.items.set(itemKey(schema.name, attributes), {
      schemaName: schema.name,
      attributes: { ...attributes },
      collection,
      label,
      password,
    });
    return true;
  },

  async password_clear(
    schema: FakeSchema,
    attributes: Attributes,
    _cancellable: unknown,
  ): Promise<boolean> {
    if (fakeSecretState.error) throw fakeSecretState.error;
    return fakeSecretState.items.delete(itemKey(schema.name, attributes));
  },
} as const;

export default Secret;
