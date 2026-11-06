# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-06

### Added

- CI workflow running type-check, unit tests, and build on every push and pull request.
- Settings item in the indicator menu for quick access to preferences.
- Release packaging: `npm run package` produces a distributable zip for
  extensions.gnome.org / GitHub.

### Changed

- The BambooHR API key is now stored in the user's keyring (libsecret) instead
  of GSettings. GSettings only holds a non-secret `api-key-version` counter.
  **Note:** after upgrading, the API key must be re-entered in the preferences
  dialog.
- GSettings schema is loaded from the extension's own `schemas/` directory
  instead of relying on compiled system schemas.

### Fixed

- `Cancellable.connect` usage and Soup request promisification.
- Narrow layout in the preferences dialog (shortened domain suffix hint,
  `SpinRow` subtitle only passed when defined).

## [0.1.0] - 2026-11-05

### Added

- Initial release of the BambooHR Timesheet GNOME Shell 51 extension.
- Panel indicator showing clock-in status and today's logged time.
- Popup menu with today's time entries, refresh, and error/empty states.
- BambooHR API client (Soup 3, Basic auth, typed errors).
- Preferences dialog (GTK4/Adw) for subdomain, API key, and refresh interval.
- Automatic refresh with proper lifecycle cleanup in `disable()`.
- TypeScript codebase bundled with esbuild; unit tests (vitest) and a GJS
  smoke test for the status logic.
- Per-entry timezone handling: "today" is computed using each entry's own
  IANA timezone to avoid midnight-rollover bugs.

[0.2.0]: https://github.com/langalex/bamboo-gnome-extension/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/langalex/bamboo-gnome-extension/releases/tag/0.1.0
