# BambooHR Timesheet — GNOME Shell 51 extension

Shows your BambooHR **clock-in status** and **today's total logged time** in the
top bar. Clicking the indicator opens a popup with today's time entries, the
day's total, and a **Clock In / Clock Out** button.

Built with **TypeScript** (bundled to GJS ESM via esbuild) for **GNOME Shell 51**.

> **Status:** Phases 1–6 done (scaffold & settings, API client, status logic,
> panel indicator + popup, refresh & lifecycle, error/empty states & polish).

## Requirements

- GNOME Shell 51 (GNOME 51)
- Node.js ≥ 18 + npm (dev-time only)
- A BambooHR **API key** with permission to view/edit your timesheet
- Company Time Tracking with clock in/out enabled (timesheet type `CLOCK`)

## Setup

1. **Get an API key:** in BambooHR, click your avatar / user menu in the
   bottom-left corner → **API Keys** → **Generate New Key**. The key is shown
   once — copy it now.
2. **Find your company domain:** it's the subdomain of your BambooHR URL,
   e.g. `https://mycompany.bamboohr.com/` → domain `mycompany`.
3. **Build & install** (see below), then open the preferences via the
   Extensions app (gear icon next to BambooHR Timesheet) or
   `gnome-extensions prefs bamboo-timesheet@alex.langs.berlin`, and enter the domain + key.

Until configured, the panel shows **"Click to configure"** — its popup has a
**Configure…** item that opens the preferences; the indicator starts tracking
on its own as soon as domain and key are saved.

## Build & install

```sh
npm install
npm run check        # type-check with tsc (no emit)
npm test             # unit tests (vitest, runs under Node)
npm run test:watch   # unit tests in watch mode
npm run test:gjs     # GJS smoke test for the compiled status logic
npm run build        # → dist/extension.js, dist/prefs.js, dist/status-test.js
npm run package      # → dist/bamboo-timesheet@alex.langs.berlin.zip (upload zip)
./install.sh         # stages into ~/.local/share/gnome-shell/extensions/
gnome-extensions enable bamboo-timesheet@alex.langs.berlin
```

Reload the shell after installing: `Alt+F2` → `r` (X11), or log out/in
(Wayland).

## Packaging for release

`npm run package` rebuilds the bundles **without inline source maps** and zips
exactly the distributable files, all at the archive root: `metadata.json`,
`extension.js`, `prefs.js`, `stylesheet.css`, and `schemas/` with both the XML
source and its compiled schema. Upload the resulting
`dist/bamboo-timesheet@alex.langs.berlin.zip` to
[extensions.gnome.org](https://extensions.gnome.org/upload/) or attach it to a
GitHub release.

Requires `glib-compile-schemas` and `zip`; without `zip` it falls back to
`python3 -m zipfile` (produces an uncompressed archive).

## What the indicator shows

| Panel label                     | Meaning                                           |
| ------------------------------- | ------------------------------------------------- |
| `● Clocked in · 4h 12m` (green) | Open clock entry; total ticks with the live entry |
| `○ Not clocked in` (gray)       | No open entry                                     |
| `Click to configure` (amber)    | No company domain / API key set yet               |
| `○ Error` (red)                 | Last fetch failed and there is no data to show    |
| `○ BambooHR` (placeholder)      | Enabled and configured, first fetch still running |

The popup lists today's entries (`start – end` and duration, the open entry as
a green live row), shows **Total today**, and offers Clock In/Out, Refresh and
Open BambooHR. A day without entries shows a dim **"No entries today"** row.

## Error handling

- **Network errors / timeouts** stay visible as a `⚠ …` row in the popup (and
  the header when no data is shown); the refresh timer keeps retrying.
- **401/403** (bad key / disabled key / missing permission) pause automatic
  refresh — BambooHR temporarily disables API access after repeated bad keys.
  A hint row says so; after fixing the key in the preferences, press
  **Refresh** (or open the popup) to retry and resume the timer.
- **409 conflicts** (e.g. "already clocked in") surface the server's message
  via a notification, and the following refresh reconciles the shown state.
- Clock in/out failures always end in a notification; refreshes never pop one.

## Development

```sh
npm run check        # type-check with tsc (no emit)
npm run watch        # rebuild bundles on change
```

Settings are edited via the GNOME Extensions app (gear icon) or
`gnome-extensions prefs bamboo-timesheet@alex.langs.berlin`.

| Setting        | Meaning                                             |
| -------------- | --------------------------------------------------- |
| Company domain | Subdomain before `.bamboohr.com` (e.g. `mycompany`) |
| API key        | Personal key from BambooHR → API Keys (kept in your user keyring) |
| Employee ID    | `0` = auto-detect via the API key's owner           |
| Refresh in/out | Seconds between refreshes while clocked in / out    |

The API key is stored in your user keyring (libsecret) — GSettings keeps only
a non-secret counter marking that a key exists. The key is never hardcoded or
logged, and it is not shown again in the preferences after saving.

## Troubleshooting

```sh
journalctl -f /usr/bin/gnome-shell      # shell errors
GJS_DEBUG_OUTPUT=all gnome-shell --replace  # verbose GJS logging (X11)
```

Sanity-check the key and permissions with curl before debugging the extension:

```sh
curl -u "{API_KEY}:x" "https://{domain}.bamboohr.com/api/v1/employees/0"
```

- `Unauthorized: check your API key` → re-generate the key; note the automatic
  refresh is paused until a manual Refresh succeeds.
- `Forbidden: the API key is disabled or lacks permission` → the key may have
  been disabled by repeated failures (wait ~10 min) or timesheet permissions
  are missing.
- Clock in/out returns 409/422 → confirm Time Tracking with clock in/out is
  enabled for your company.
- The key lives in your user keyring; if the item was deleted there (e.g. via
  Seahorse), the indicator shows `○ Error` — enter the key again in the
  preferences.
