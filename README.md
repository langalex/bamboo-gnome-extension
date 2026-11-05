# BambooHR Timesheet — GNOME Shell 51 extension

Shows your BambooHR **clock-in status** and **today's total logged time** in the
top bar. Clicking the indicator opens a popup with today's time entries, the
day's total, and a **Clock In / Clock Out** button.

Built with **TypeScript** (bundled to GJS ESM via esbuild) for **GNOME Shell 51**.

> **Status:** Phases 1–3 done (scaffold, settings, API client, status logic with
> GJS unit tests). Phase 4 (panel indicator + popup) is next.

## Requirements

- GNOME Shell 51 (GNOME 51)
- Node.js ≥ 18 + npm (dev-time only)
- A BambooHR **API key** (avatar menu bottom-left → **API Keys**) with
  permission to view/edit your timesheet

## Build & install

```sh
npm install
npm run check        # type-check with tsc (no emit)
npm test             # GJS unit tests for the status logic
npm run build        # → dist/extension.js, dist/prefs.js, dist/status-test.js
./install.sh         # stages into ~/.local/share/gnome-shell/extensions/
gnome-extensions enable bamboo-timesheet@user
```

Reload the shell after installing: `Alt+F2` → `r` (X11), or log out/in
(Wayland).

## Development

```sh
npm run check        # type-check with tsc (no emit)
npm run watch        # rebuild bundles on change
```

Settings are edited via the GNOME Extensions app (gear icon) or
`gnome-extensions prefs bamboo-timesheet@user`.

## Configuration

| Setting        | Meaning                                             |
| -------------- | --------------------------------------------------- |
| Company domain | Subdomain before `.bamboohr.com` (e.g. `mycompany`) |
| API key        | Personal key from BambooHR → API Keys               |
| Employee ID    | `0` = auto-detect via the API key's owner           |
| Refresh in/out | Seconds between refreshes while clocked in / out    |

## Troubleshooting

```sh
journalctl -f /usr/bin/gnome-shell      # shell errors
GJS_DEBUG_OUTPUT=all gnome-shell --replace  # verbose GJS logging (X11)
```

See `PLAN.md` for the full plan and API details.
