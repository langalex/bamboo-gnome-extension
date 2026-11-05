// Vitest config: unit tests run under plain Node, so the GJS-native `gi://`
// imports are aliased to hand-written stubs in test/mocks/. Everything else
// (pure TS under src/lib) runs unmodified.
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const mock = (name: string) =>
  fileURLToPath(new URL(`./test/mocks/${name}.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^gi:\/\/GLib$/, replacement: mock("glib") },
      { find: /^gi:\/\/Gio$/, replacement: mock("gio") },
      { find: /^gi:\/\/Soup\?version=3\.0$/, replacement: mock("soup") },
    ],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Pin the process timezone so formatTime/formatTimeSeconds assertions are
    // deterministic regardless of the machine's locale.
    env: { TZ: "UTC" },
  },
});
