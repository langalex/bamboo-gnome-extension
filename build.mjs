// Build script: bundles src/extension.ts and src/prefs.ts into single-file ESM
// bundles (GJS 1.72+ supports native ESM; no CommonJS available at runtime).
//
// The GNOME 51 resource-based extension loader expects, in the installed dir:
//   - extension.js        (bundle of src/extension.ts)
//   - prefs.js            (bundle of src/prefs.ts)
//   - schemas/*.gschema.xml   (compiled via GSETTINGS_SCHEMA_DIR, see install.sh)
//   - metadata.json, stylesheet.css
//
// GJS import specifiers (gi: GObject, Gio, GLib, St, Soup, ...) and bare
// imports of the `resource:///org/gnome/shell/...` modules are left external.

import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const outdir = join(root, "dist");

// `--release`: skip the inline source maps (published bundles ship without
// them); dev builds keep them for readable stack traces under GJS.
const release = process.argv.includes("--release");

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: ["es2022"],
  mainFields: ["module", "main"],
  sourcemap: release ? false : "inline",
  sourcesContent: false,
  logLevel: "info",
  // GJS resolves these at runtime; never bundle them.
  external: ["gi:*", "resource://*", "gettext", "cairo"],
  // Not a node program: suppress node builtin / node: prefix assumptions.
  banner: { js: "// GENERATED FILE - do not edit. Run `npm run build`." },
};

const entries = [
  { in: join(root, "src/extension.ts"), out: "extension.js" },
  { in: join(root, "src/prefs.ts"), out: "prefs.js" },
  // Standalone status.ts bundle for the GJS test harness: entry-point exports
  // are never tree-shaken, so every helper is present for testing.
  { in: join(root, "src/lib/status.ts"), out: "status-test.js" },
];

// Build each entry with an explicit output filename.
const entryPoints = entries.map((e) => ({
  in: e.in,
  out: e.out.replace(/\.js$/, ""),
}));

const watch = process.argv.includes("--watch");

if (watch) {
  const ctx = await context({
    ...common,
    entryPoints,
    outdir,
    entryNames: "[name]",
    outExtension: { ".js": ".js" },
  });
  await ctx.watch();
  console.log("watching for changes…");
} else {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  await build({
    ...common,
    entryPoints,
    outdir,
    entryNames: "[name]",
  });

  // Copy static assets next to the bundles (metadata.json is needed by the
  // GNOME 51 resource loader only if it is NOT bundled; we bundle it below).
  await cp(join(root, "stylesheet.css"), join(outdir, "stylesheet.css"));

  // GNOME 51 resource-based extensions: the metadata.json is embedded into the
  // extension.js bundle by esbuild? No - GJS reads metadata from the bundle's
  // `meta` export when it exists. Emit `export const meta` so gjs can find it.
  const meta = JSON.parse(await readFile(join(root, "metadata.json"), "utf8"));
  await writeFile(
    join(outdir, "extension.js"),
    (await readFile(join(outdir, "extension.js"), "utf8")) +
      `\nexport const meta = ${JSON.stringify(meta, null, 2)};\n`,
  );
}
