import { beforeEach, describe, expect, it } from "vitest";
import {
  clearApiKey,
  lookupApiKey,
  storeApiKey,
} from "../src/lib/secrets.js";
import { fakeSecretState, resetSecrets } from "./mocks/secret.js";

const UUID = "bamboo-timesheet@alex.langs.berlin";

beforeEach(resetSecrets);

describe("storeApiKey", () => {
  it("stores into the default collection under the extension's uuid", async () => {
    await storeApiKey(UUID, "secret-key");

    const [key] = [...fakeSecretState.items.keys()];
    expect(key).toBe(
      "org.gnome.shell.extensions.bamboo-timesheet::" +
        JSON.stringify({ uuid: UUID }),
    );
    const item = fakeSecretState.items.get(key);
    expect(item?.collection).toBe("default");
    expect(item?.label).toBe("BambooHR Timesheet API key");
    expect(item?.password).toBe("secret-key");
  });

  it("replaces an already stored key instead of adding a second item", async () => {
    await storeApiKey(UUID, "old-key");
    await storeApiKey(UUID, "new-key");

    expect(fakeSecretState.items.size).toBe(1);
    expect(await lookupApiKey(UUID)).toBe("new-key");
  });
});

describe("lookupApiKey", () => {
  it("returns null when no key is stored", async () => {
    expect(await lookupApiKey(UUID)).toBeNull();
  });

  it("returns the stored key", async () => {
    await storeApiKey(UUID, "secret-key");
    expect(await lookupApiKey(UUID)).toBe("secret-key");
  });

  it("treats an empty secret as missing", async () => {
    fakeSecretState.lookupResult = "";
    expect(await lookupApiKey(UUID)).toBeNull();
  });

  it("is bound to the given uuid, not any other extension's item", async () => {
    await storeApiKey("other-uuid@witha.dots", "not-mine");
    expect(await lookupApiKey(UUID)).toBeNull();
  });
});

describe("clearApiKey", () => {
  it("removes the stored key", async () => {
    await storeApiKey(UUID, "secret-key");

    await clearApiKey(UUID);

    expect(await lookupApiKey(UUID)).toBeNull();
  });

  it("resolves even when nothing was stored", async () => {
    await expect(clearApiKey(UUID)).resolves.toBeUndefined();
  });
});

describe("keyring failures", () => {
  it("surface as rejections from store", async () => {
    fakeSecretState.error = new Error("secret service unavailable");

    await expect(storeApiKey(UUID, "secret-key")).rejects.toThrow(
      "secret service unavailable",
    );
    expect(fakeSecretState.items.size).toBe(0);
  });

  it("surface as rejections from lookup", async () => {
    fakeSecretState.error = new Error("keyring locked");

    await expect(lookupApiKey(UUID)).rejects.toThrow("keyring locked");
  });
});
