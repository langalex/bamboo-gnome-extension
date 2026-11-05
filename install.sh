#!/usr/bin/env bash
# Dev install for the BambooHR Timesheet GNOME extension.
#
# Builds the TypeScript bundles, compiles the GSettings schema, and stages
# everything into ~/.local/share/gnome-shell/extensions/<uuid>/.
#
# Requirements: node + npm (for the build), glib-compile-schemas, gnome-shell 51.
set -euo pipefail

UUID="bamboo-timesheet@user"
EXT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

cd "$(dirname "$0")"

echo "==> Building bundles (npm run build)"
npm run build

echo "==> Staging into $EXT_DIR"
rm -rf "$EXT_DIR"
mkdir -p "$EXT_DIR/schemas"

cp dist/extension.js "$EXT_DIR/extension.js"
cp dist/prefs.js "$EXT_DIR/prefs.js"
cp metadata.json "$EXT_DIR/metadata.json"
cp stylesheet.css "$EXT_DIR/stylesheet.css"
cp schemas/org.gnome.shell.extensions.bamboo-timesheet.gschema.xml \
  "$EXT_DIR/schemas/"

echo "==> Compiling GSettings schema"
glib-compile-schemas --strict "$EXT_DIR/schemas" || {
  echo "ERROR: glib-compile-schemas failed - is it installed?" >&2
  exit 1
}

echo "==> Installed. Enable with:"
echo "    gnome-extensions enable $UUID"
echo "  (or via gnome-extensions-app). Reload the shell (Alt+F2 r, or log out"
echo "   and back in on Wayland) for the extension to be picked up."
