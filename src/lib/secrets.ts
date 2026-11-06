import Gio from "gi://Gio";
import Secret from "gi://Secret";

// Don't rely on GJS's implicit callback→Promise conversion for introspected
// async functions (see src/lib/bamboohr.ts); promisify explicitly so the
// awaitable forms below work in every GJS host.
Gio._promisify(Secret, "password_store", "password_store_finish");
Gio._promisify(Secret, "password_lookup", "password_lookup_finish");
Gio._promisify(Secret, "password_clear", "password_clear_finish");

/**
 * Keyring storage for the BambooHR API key (libsecret).
 *
 * The key never touches GSettings: dconf is readable by every process of the
 * user, while the keyring is unlocked per session and can be locked. GSettings
 * instead keeps the non-secret `api-key-version` counter (see
 * src/lib/settings.ts), which the extension and the preferences use to
 * coordinate without ever seeing the secret.
 */

const SCHEMA_NAME = "org.gnome.shell.extensions.bamboo-timesheet";

/** Label under which the item appears in keyring UIs (e.g. Seahorse). */
const ITEM_LABEL = "BambooHR Timesheet API key";

/** One schema per extension uuid; the uuid is the keyring lookup attribute. */
const schemas = new Map<string, Secret.Schema>();

function schemaFor(uuid: string): Secret.Schema {
  let schema = schemas.get(uuid);
  if (!schema) {
    schema = Secret.Schema.new(SCHEMA_NAME, Secret.SchemaFlags.NONE, {
      uuid: Secret.SchemaAttributeType.STRING,
    });
    schemas.set(uuid, schema);
  }
  return schema;
}

function attributesFor(uuid: string): { [key: string]: string } {
  return { uuid };
}

/** Read the API key from the user's keyring; null when none is stored. */
export async function lookupApiKey(
  uuid: string,
  cancellable: Gio.Cancellable | null = null,
): Promise<string | null> {
  // The runtime can hand back an empty string for a wiped item — treat that
  // like a missing secret.
  return (await Secret.password_lookup(
    schemaFor(uuid),
    attributesFor(uuid),
    cancellable,
  )) || null;
}

/** Create or replace the keyring item holding the API key. */
export async function storeApiKey(uuid: string, apiKey: string): Promise<void> {
  await Secret.password_store(
    schemaFor(uuid),
    attributesFor(uuid),
    Secret.COLLECTION_DEFAULT,
    ITEM_LABEL,
    apiKey,
    null,
  );
}

/** Remove the API key from the keyring; resolves even when absent. */
export async function clearApiKey(uuid: string): Promise<void> {
  await Secret.password_clear(schemaFor(uuid), attributesFor(uuid), null);
}
