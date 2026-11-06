// Packaging: builds the distributable extension zip for
// extensions.gnome.org (or a GitHub release). Run via `npm run package`,
// which release-builds the bundles first.
//
// The zip contains exactly what a published extension may ship, all at the
// zip root (no wrapping directory):
//   metadata.json, extension.js, prefs.js, stylesheet.css, schemas/
// where schemas/ holds both the XML source and the compiled gschemas.compiled
// (hand-installers need the compiled schema; EGO rebuilds it during review).
//
// Requires `glib-compile-schemas`, plus `zip` — or `python3` as a fallback
// (its zipfile CLI stores files uncompressed).

import { execFile } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const stage = join(root, "dist", ".package");

const SCHEMA_FILE = "org.gnome.shell.extensions.bamboo-timesheet.gschema.xml";

async function zipDirectory(dir, outZip) {
  const entries = await readdir(dir);
  try {
    await run("zip", ["-rq", outZip, ...entries], { cwd: dir });
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    await run("python3", ["-m", "zipfile", "-c", outZip, ...entries], {
      cwd: dir,
    });
  }
}

const meta = JSON.parse(await readFile(join(root, "metadata.json"), "utf8"));
const zipPath = join(root, "dist", `${meta.uuid}.zip`);

console.log(`==> Staging ${meta.uuid}`);
await rm(stage, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(join(stage, "schemas"), { recursive: true });

for (const file of ["extension.js", "prefs.js"]) {
  await cp(join(root, "dist", file), join(stage, file));
}
await cp(join(root, "metadata.json"), join(stage, "metadata.json"));
await cp(join(root, "stylesheet.css"), join(stage, "stylesheet.css"));
await cp(join(root, "schemas", SCHEMA_FILE), join(stage, "schemas", SCHEMA_FILE));

// Runtime resolves the *compiled* schema (see loadSettings() in
// src/lib/settings.ts), so the zip must ship it alongside the XML.
console.log("==> Compiling GSettings schema");
await run("glib-compile-schemas", ["--strict", join(stage, "schemas")]);

console.log("==> Writing zip (contents at the archive root):");
for (const entry of await readdir(stage, { recursive: true })) {
  console.log(`    ${entry}`);
}

await zipDirectory(stage, zipPath);
await rm(stage, { recursive: true, force: true });

const kib = Math.max(1, Math.round((await stat(zipPath)).size / 1024));
console.log(`==> ${zipPath.replace(`${root}/`, "")} (${kib} KiB)`);
console.log("    Ready to upload at https://extensions.gnome.org/upload/");
