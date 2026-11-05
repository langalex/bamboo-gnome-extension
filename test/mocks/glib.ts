/**
 * Minimal GLib stub for unit tests (vitest.config.ts aliases `gi://GLib`
 * here). Only implements the surface used by src/lib.
 */
const GLib = {
  PRIORITY_DEFAULT: 0,
  SOURCE_REMOVE: false,
  SOURCE_CONTINUE: true,

  /** Binary-safe base64, matching GLib.base64_encode. */
  base64_encode(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return Buffer.from(binary, "binary").toString("base64");
  },

  Bytes: class Bytes {
    readonly #data: Uint8Array;

    constructor(data?: Uint8Array | ArrayBuffer | number[]) {
      this.#data =
        data === undefined ? new Uint8Array(0) : new Uint8Array(data);
    }

    toArray(): Uint8Array {
      return this.#data;
    }
  },

  // Timer stubs: request timeouts are not exercised in unit tests.
  timeout_add(
    _priority: number,
    _intervalMs: number,
    _fn: () => boolean,
  ): number {
    return 1;
  },
  source_remove(_id: number): void {},
} as const;

export default GLib;
