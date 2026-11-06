import GLib from "gi://GLib";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Clutter from "gi://Clutter";
import St from "gi://St";
import { Extension } from "@girs/gnome-shell/extensions/extension";
import * as Main from "@girs/gnome-shell/ui/main";
import { Button } from "@girs/gnome-shell/ui/panelMenu";
import {
  PopupBaseMenuItem,
  PopupMenu,
  PopupMenuItem,
  PopupSeparatorMenuItem,
} from "@girs/gnome-shell/ui/popupMenu";
import { BambooApiError, BambooClient } from "./lib/bamboohr.js";
import { lookupApiKey } from "./lib/secrets.js";
import {
  getSettings,
  loadSettings,
  SettingsKeys,
  type BambooSettings,
} from "./lib/settings.js";
import {
  formatDuration,
  formatHours,
  formatTime,
  parseIso,
  summarizeToday,
  type TodaySummary,
} from "./lib/status.js";
import type { ClockEntry } from "./lib/types.js";

/**
 * Floor for the settings-driven refresh intervals; a zero/negative interval
 * would arm a zero-second timeout and hammer the API in a busy loop.
 */
const MIN_REFRESH_INTERVAL_SECONDS = 5;

/** Maximum characters of an error message shown in the popup header. */
const MAX_ERROR_LENGTH = 90;

/**
 * HTTP statuses that mean "the key is wrong or not permitted". BambooHR
 * temporarily disables API access after repeated bad keys, so these stop the
 * refresh timer instead of being retried at the settings-driven cadence.
 */
const AUTH_ERROR_STATUSES = [401, 403];

/** Callbacks the indicator invokes on user interaction. */
interface IndicatorActions {
  /** Re-fetch data from the API. */
  refresh(): void;
  /** Clock in when clocked out, and vice versa. */
  toggleClock(): void;
  /** Open the BambooHR web app in the default browser. */
  openBamboo(): void;
  /** Open the extension's preferences dialog. */
  openPrefs(): void;
}

/** Extra render state for the indicator beyond a summary + error. */
interface UiState {
  /** Passive first-run mode: popup offers to open the preferences. */
  unconfigured?: boolean;
  /** Auto-refresh is paused after a 401/403; a manual Refresh re-arms it. */
  authPaused?: boolean;
}

/** Collapse whitespace and clip an error message for the popup header. */
function truncate(text: string, maxLength: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= maxLength
    ? clean
    : `${clean.slice(0, maxLength - 1)}…`;
}

/**
 * One popup row: `start – end` on the left, duration on the right.
 * The live (open) row shows `– (live)` and the growing duration in green.
 */
function makeRow(
  timeText: string,
  durationText: string,
  opts: { live?: boolean; total?: boolean } = {},
): PopupBaseMenuItem {
  const timeClasses = ["bamboo-entry-time"];
  if (opts.live) timeClasses.push("bamboo-entry-live");
  const durationClasses = ["bamboo-entry-time"];
  if (opts.live) durationClasses.push("bamboo-entry-live");
  if (opts.total) durationClasses.push("bamboo-popup-total");

  const item = new PopupBaseMenuItem({ reactive: false, can_focus: false });
  item.add_child(
    new St.Label({
      text: timeText,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      style_class: timeClasses.join(" "),
    }),
  );
  item.add_child(
    new St.Label({
      text: durationText,
      y_align: Clutter.ActorAlign.CENTER,
      style_class: durationClasses.join(" "),
    }),
  );
  return item;
}

/** Popup row for a clock entry; open entries render as the live row. */
function makeEntryRow(entry: ClockEntry, now: Date): PopupBaseMenuItem {
  const start = parseIso(entry.start);
  if (entry.end === null) {
    const liveMs = Math.max(0, now.getTime() - start.getTime());
    return makeRow(`${formatTime(start)} – (live)`, formatDuration(liveMs), {
      live: true,
    });
  }
  return makeRow(
    `${formatTime(start)} – ${formatTime(parseIso(entry.end))}`,
    formatHours(entry.hours),
  );
}

const BambooIndicator = GObject.registerClass(
  { GTypeName: "BambooTimesheetIndicator" },
  class BambooIndicator extends Button {
    // GJS dispatches `_init` from inside the base constructor, before class
    // field initializers run — every field therefore uses `declare` (no emit)
    // and is assigned in `_init`. Fields with initializers would clobber the
    // values assigned here (verified with the shell's GJS 1.90).
    declare _label: St.Label;
    declare _menu: PopupMenu;
    declare _actions: IndicatorActions | null;

    override _init(): void {
      super._init(0.0, "BambooHR Timesheet");
      this._menu = this.menu as PopupMenu;
      this._actions = null;
      this.add_style_class_name("bamboo-indicator");
      this._label = new St.Label({
        text: "○ BambooHR",
        style_class: "bamboo-status-label",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.add_child(this._label);
      this._render(null, null);
    }

    /** Wire the interaction callbacks; call before adding to the panel. */
    setActions(actions: IndicatorActions): void {
      this._actions = actions;
    }

    /**
     * Passive first-run state: the panel asks to be configured and the popup
     * offers to open the preferences. No API client or refresh timer backing.
     */
    showUnconfigured(): void {
      this._render(null, null, { unconfigured: true });
    }

    /** Re-render the panel label and the whole popup from a summary. */
    update(
      summary: TodaySummary | null,
      error: string | null,
      state: UiState = {},
    ): void {
      this._render(summary, error, state);
    }

    _render(
      summary: TodaySummary | null,
      error: string | null,
      state: UiState = {},
    ): void {
      const { unconfigured = false, authPaused = false } = state;
      // Panel label: "● Clocked in · 4h 12m" / "○ Not clocked in" / the bare
      // placeholder before the first fetch / red "○ Error" while erroring
      // with no data / amber "Click to configure" until domain + key are set.
      if (unconfigured) {
        this._label.set_text("Click to configure");
      } else if (summary?.clockedIn) {
        this._label.set_text(
          `● Clocked in · ${formatDuration(summary.totalMs)}`,
        );
      } else if (summary) {
        this._label.set_text("○ Not clocked in");
      } else if (error) {
        this._label.set_text("○ Error");
      } else {
        this._label.set_text("○ BambooHR");
      }

      for (const cls of [
        "clocked-in",
        "clocked-out",
        "bamboo-error",
        "bamboo-unconfigured",
      ]) {
        this.remove_style_class_name(cls);
      }
      if (unconfigured) {
        this.add_style_class_name("bamboo-unconfigured");
      } else if (error && !summary) {
        this.add_style_class_name("bamboo-error");
      } else if (summary?.clockedIn) {
        this.add_style_class_name("clocked-in");
      } else {
        this.add_style_class_name("clocked-out");
      }

      this._rebuildMenu(summary, error, { unconfigured, authPaused });
    }

    _rebuildMenu(
      summary: TodaySummary | null,
      error: string | null,
      state: UiState,
    ): void {
      const menu = this._menu;
      menu.removeAll();

      if (state.unconfigured) {
        menu.addMenuItem(
          new PopupMenuItem("Not configured", {
            reactive: false,
            can_focus: false,
          }),
        );
        menu.addMenuItem(new PopupSeparatorMenuItem());
        const hint = new PopupMenuItem(
          "Set your BambooHR company domain and API key",
          { reactive: false, can_focus: false },
        );
        hint.label.add_style_class_name("dim-label");
        menu.addMenuItem(hint);
        menu.addMenuItem(new PopupSeparatorMenuItem());
        const configure = new PopupMenuItem("Configure…");
        configure.connect("activate", () => this._actions?.openPrefs());
        menu.addMenuItem(configure);
        return;
      }

      // Status header.
      let header: string;
      if (summary) {
        const since = summary.clockedInSince;
        header = summary.clockedIn
          ? since
            ? `Clocked in since ${formatTime(since)}`
            : "Clocked in"
          : "Not clocked in";
      } else if (error) {
        header = `Error: ${truncate(error, MAX_ERROR_LENGTH)}`;
      } else {
        header = "Refreshing…";
      }
      menu.addMenuItem(
        new PopupMenuItem(header, { reactive: false, can_focus: false }),
      );
      menu.addMenuItem(new PopupSeparatorMenuItem());

      // Surface the last failure even when stale data is still on display;
      // with no data the header itself already carries the error.
      if (error && summary) {
        const errRow = new PopupMenuItem(
          `⚠ ${truncate(error, MAX_ERROR_LENGTH)}`,
          { reactive: false, can_focus: false },
        );
        errRow.label.add_style_class_name("bamboo-popup-error");
        menu.addMenuItem(errRow);
      }
      if (state.authPaused) {
        const hint = new PopupMenuItem(
          "Auto-refresh paused — fix the API key, then Refresh",
          { reactive: false, can_focus: false },
        );
        hint.label.add_style_class_name("bamboo-popup-hint");
        menu.addMenuItem(hint);
      }

      if (summary) {
        const now = new Date();
        if (summary.entries.length === 0 && !summary.openEntry) {
          const empty = new PopupMenuItem("No entries today", {
            reactive: false,
            can_focus: false,
          });
          empty.label.add_style_class_name("dim-label");
          menu.addMenuItem(empty);
        }
        for (const entry of summary.entries) {
          menu.addMenuItem(makeEntryRow(entry, now));
        }
        if (summary.openEntry) {
          menu.addMenuItem(makeEntryRow(summary.openEntry, now));
        }

        menu.addMenuItem(new PopupSeparatorMenuItem());
        menu.addMenuItem(
          makeRow("Total today", formatDuration(summary.totalMs), {
            total: true,
          }),
        );
        menu.addMenuItem(
          makeRow("Total this week", formatDuration(summary.weekTotalMs), {
            total: true,
          }),
        );
      }
      menu.addMenuItem(new PopupSeparatorMenuItem());

      const clockItem = new PopupMenuItem(
        summary?.clockedIn ? "Clock Out" : "Clock In",
      );
      clockItem.connect("activate", () => this._actions?.toggleClock());
      menu.addMenuItem(clockItem);

      const refreshItem = new PopupMenuItem("Refresh");
      refreshItem.connect("activate", () => this._actions?.refresh());
      menu.addMenuItem(refreshItem);

      const openItem = new PopupMenuItem("Open BambooHR");
      openItem.connect("activate", () => this._actions?.openBamboo());
      menu.addMenuItem(openItem);

      const settingsItem = new PopupMenuItem("Settings…");
      settingsItem.connect("activate", () => this._actions?.openPrefs());
      menu.addMenuItem(settingsItem);
    }
  },
);

/** GNOME 51 ESM extension entry point. */
export default class BambooTimesheetExtension extends Extension {
  #settings: Gio.Settings | null = null;
  #client: BambooClient | null = null;
  #companyDomain = "";
  #employeeId = 0;
  // Employee id resolved via the API when the settings value is 0; reset on
  // client rebuilds so a domain/key change re-detects it.
  #resolvedEmployeeId = 0;
  // GSettings `api-key-version` the cached client was built against; a
  // mismatch in #getClient triggers a keyring re-read and a client rebuild.
  #apiKeyVersion = 0;
  #indicator: InstanceType<typeof BambooIndicator> | null = null;
  #entries: ClockEntry[] = [];
  #lastError: string | null = null;
  // True once a fetch has succeeded; the popup stays in its "Refreshing…"
  // placeholder state until then.
  #fetched = false;
  // Guards overlapping clock-in/out POSTs; overlapping refreshes are instead
  // superseded via cancellables in #refresh.
  #actionBusy = false;
  // Clock-in state of the last render; picks the timer interval in #armTimer.
  #clockedIn = false;
  // Cancellable of the in-flight refresh flow. A newer refresh (or disable())
  // cancels it so a stale response can never land after and overwrite a
  // fresher one.
  #refreshCancellable: Gio.Cancellable | null = null;
  #tickSource = 0;
  #menuOpenId = 0;
  // GSettings `changed` id while in the unconfigured first-run state; lets the
  // extension start on its own once a domain + key are saved in the prefs.
  #settingsChangedId = 0;
  // Set on a 401/403: the refresh timer is paused (BambooHR disables API
  // access after repeated bad keys); a manual Refresh can still retry.
  #authFailed = false;

  override enable(): void {
    const settings = loadSettings(this.dir.get_child("schemas").get_path());
    const cfg = getSettings(settings);
    this.#settings = settings;

    // Phase 6: with no domain/key set, keep a passive indicator that offers to
    // open the preferences and starts by itself once they are filled in.
    if (!cfg.configured) {
      console.log(
        "[bamboo-timesheet] not configured: set company domain and API key in preferences",
      );
      this.#enterUnconfiguredMode(settings, cfg.companyDomain);
      return;
    }
    this.#startConfigured(cfg);
  }

  /** Passive first-run mode: indicator only, no client or timers. */
  #enterUnconfiguredMode(settings: Gio.Settings, companyDomain: string): void {
    this.#companyDomain = companyDomain;

    this.#indicator = new BambooIndicator();
    this.#indicator.setActions({
      refresh: () => {},
      toggleClock: () => {},
      openBamboo: () => this.#openBamboo(),
      openPrefs: () => this.openPreferences(),
    });
    this.#indicator.showUnconfigured();
    Main.panel.addToStatusArea(this.uuid, this.#indicator);

    // Start automatically once the prefs window saves a domain + key — no
    // enable/disable round-trip needed. Both keys may arrive in one `changed`
    // burst, so only the first configured emission transitions.
    this.#settingsChangedId = settings.connect("changed", () => {
      if (this.#settingsChangedId === 0) return;
      const cfg = getSettings(settings);
      if (!cfg.configured) return;
      settings.disconnect(this.#settingsChangedId);
      this.#settingsChangedId = 0;
      this.#indicator?.destroy();
      this.#indicator = null;
      this.#startConfigured(cfg);
    });
  }

  /** Full data mode: API client, popup actions, initial refresh + timer. */
  #startConfigured(cfg: BambooSettings): void {
    const settings = this.#settings;
    if (!settings) return;

    this.#companyDomain = cfg.companyDomain;
    this.#employeeId = cfg.employeeId;
    // The client is built lazily by #getClient: the API key comes from the
    // keyring, so its lookup has to await.
    this.#entries = [];
    this.#lastError = null;
    this.#fetched = false;
    this.#actionBusy = false;
    this.#clockedIn = false;
    this.#authFailed = false;
    this.#refreshCancellable = null;

    this.#indicator = new BambooIndicator();
    this.#indicator.setActions({
      refresh: () => void this.#refresh(),
      toggleClock: () => void this.#toggleClock(),
      openBamboo: () => this.#openBamboo(),
      openPrefs: () => this.openPreferences(),
    });
    Main.panel.addToStatusArea(this.uuid, this.#indicator);

    // Refresh whenever the popup opens so the rows and the live total are
    // current without waiting for the next timer tick. `Button.menu` is a
    // union (shell PopupMenu | dummy) — cast like the indicator does.
    const menu = this.#indicator.menu as PopupMenu;
    this.#menuOpenId = menu.connect("open-state-changed", (_menu, open) => {
      if (!open) return;
      this.#updateUi();
      void this.#refresh();
    });

    this.#armTimer();
    void this.#refresh();
  }

  override disable(): void {
    if (this.#settingsChangedId !== 0) {
      this.#settings?.disconnect(this.#settingsChangedId);
      this.#settingsChangedId = 0;
    }
    if (this.#tickSource !== 0) {
      GLib.source_remove(this.#tickSource);
      this.#tickSource = 0;
    }
    if (this.#menuOpenId !== 0) {
      this.#indicator?.menu.disconnect(this.#menuOpenId);
      this.#menuOpenId = 0;
    }
    // Cancel any in-flight request before dropping the session.
    this.#refreshCancellable?.cancel();
    this.#refreshCancellable = null;
    // Destroying the indicator removes it from the panel and destroys the menu
    // (including all item signal connections).
    this.#indicator?.destroy();
    this.#indicator = null;
    this.#client?.abort();
    this.#client = null;
    this.#settings = null;
    this.#companyDomain = "";
    this.#employeeId = 0;
    this.#resolvedEmployeeId = 0;
    this.#apiKeyVersion = 0;
    this.#entries = [];
    this.#lastError = null;
    this.#fetched = false;
    this.#actionBusy = false;
    this.#clockedIn = false;
    this.#authFailed = false;
  }

  /**
   * The API client for the current settings, (re)building it when the company
   * domain changed or the keyring key was replaced. Returns null when the
   * settings no longer name a key; throws when the keyring has no key even
   * though the settings claim one (e.g. the item was deleted externally).
   */
  async #getClient(
    cancellable?: Gio.Cancellable,
  ): Promise<BambooClient | null> {
    const settings = this.#settings;
    if (!settings) return null;
    const companyDomain = settings
      .get_string(SettingsKeys.CompanyDomain)
      .trim();
    const apiKeyVersion = settings.get_int(SettingsKeys.ApiKeyVersion);
    if (!companyDomain || apiKeyVersion <= 0) return null;
    if (
      this.#client &&
      companyDomain === this.#companyDomain &&
      apiKeyVersion === this.#apiKeyVersion
    ) {
      return this.#client;
    }
    const apiKey = await lookupApiKey(this.uuid, cancellable ?? null);
    if (!apiKey) {
      throw new Error(
        "API key not found in the keyring — save it again in the preferences",
      );
    }
    if (!this.#settings) return null;
    this.#client?.abort();
    this.#client = new BambooClient({ companyDomain, apiKey });
    this.#companyDomain = companyDomain;
    this.#apiKeyVersion = apiKeyVersion;
    this.#employeeId = settings.get_int(SettingsKeys.EmployeeId);
    this.#resolvedEmployeeId = 0;
    return this.#client;
  }

  async #refresh(): Promise<void> {
    // Supersede any in-flight refresh: cancel its token so its response can
    // never land after ours and overwrite fresher data with stale state.
    this.#refreshCancellable?.cancel();
    const cancellable = new Gio.Cancellable();
    this.#refreshCancellable = cancellable;
    try {
      const client = await this.#getClient(cancellable);
      if (cancellable.is_cancelled()) return;
      if (!client) return;
      const employeeId = await this.#resolveEmployeeId(client, cancellable);
      const now = new Date();
      // A 48h window so an entry opened yesterday but still running is
      // included; "today" is then filtered per entry in the entry's timezone.
      const from = new Date(now);
      from.setDate(from.getDate() - 1);
      // The week total needs entries back to Monday; one extra day covers
      // timezone skew between the host and the entry's timezone.
      const weekFrom = new Date(now);
      weekFrom.setDate(weekFrom.getDate() - ((weekFrom.getDay() + 6) % 7) - 1);
      if (weekFrom < from) from.setTime(weekFrom.getTime());
      from.setHours(0, 0, 0, 0);
      const to = new Date(now);
      to.setDate(to.getDate() + 1);
      to.setHours(23, 59, 59, 999);

      const { data } = await client.listClockEntries(
        employeeId,
        from,
        to,
        cancellable,
      );
      if (cancellable.is_cancelled()) return;
      this.#entries = data;
      this.#lastError = null;
      this.#fetched = true;
      this.#authFailed = false;
    } catch (err) {
      // Cancelled means superseded by a newer refresh or the extension was
      // disabled — the winner owns the UI, so don't surface the error.
      if (cancellable.is_cancelled()) return;
      this.#lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[bamboo-timesheet] refresh failed: ${this.#lastError}`);
      // A wrong or unauthorized key must not be hammered: BambooHR disables
      // API access after repeated bad keys, so pause the refresh timer and
      // wait for a manual Refresh (e.g. after fixing the key in prefs).
      if (
        err instanceof BambooApiError &&
        AUTH_ERROR_STATUSES.includes(err.status)
      ) {
        if (!this.#authFailed) {
          console.warn(
            `[bamboo-timesheet] auth failed (HTTP ${err.status}) — automatic refresh paused until a successful refresh`,
          );
        }
        this.#authFailed = true;
      }
    } finally {
      if (this.#refreshCancellable === cancellable) {
        this.#refreshCancellable = null;
      }
    }
    this.#updateUi();
    this.#armTimer();
  }

  async #toggleClock(): Promise<void> {
    // Only guards against concurrent clock-in/out POSTs; a refresh in flight
    // is superseded by the one this action triggers below.
    if (this.#actionBusy) return;
    const clockedIn = summarizeToday(this.#entries, new Date()).clockedIn;
    this.#actionBusy = true;
    try {
      const client = await this.#getClient();
      if (!client) return;
      const employeeId = await this.#resolveEmployeeId(client);
      if (employeeId <= 0) {
        throw new Error("Could not resolve the BambooHR employee id");
      }
      if (clockedIn) {
        await client.clockOut({ employeeId });
      } else {
        await client.clockIn({
          employeeId,
          // BambooHR requires the IANA timezone of the clock-in location.
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[bamboo-timesheet] clock ${clockedIn ? "out" : "in"} failed: ${message}`,
      );
      // Skip the notification when disabled mid-flight: the session abort
      // surfaces a cancelled request, which is not worth a popup on logout.
      if (this.#client) {
        Main.notifyError(
          "BambooHR",
          `Clock ${clockedIn ? "out" : "in"} failed: ${message}`,
        );
      }
    } finally {
      this.#actionBusy = false;
    }
    await this.#refresh();
  }

  #openBamboo(): void {
    const domain = this.#companyDomain.trim();
    if (!domain) return;
    const url = `https://${domain}.bamboohr.com/`;
    try {
      Gio.AppInfo.launch_default_for_uri(url, null);
    } catch (err) {
      console.warn(
        `[bamboo-timesheet] could not open ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Employee id from settings (0 = auto-detect), resolved once via the API. */
  async #resolveEmployeeId(
    client: BambooClient,
    cancellable?: Gio.Cancellable,
  ): Promise<number> {
    if (this.#employeeId > 0) return this.#employeeId;
    if (this.#resolvedEmployeeId > 0) return this.#resolvedEmployeeId;
    const me = await client.getSelf(cancellable);
    this.#resolvedEmployeeId = Number(me.id) || 0;
    return this.#resolvedEmployeeId;
  }

  /**
   * (Re)start the one-shot refresh timer: `refresh-interval-in` while clocked
   * in (keeps the live total ticking) and `refresh-interval-out` otherwise.
   * Called after every refresh attempt — success or failure — so the next
   * cycle picks up interval or clock-state changes.
   */
  #armTimer(): void {
    if (this.#tickSource !== 0) {
      GLib.source_remove(this.#tickSource);
      this.#tickSource = 0;
    }
    const settings = this.#settings;
    // Disabled: don't schedule anything (disable() has cleared the sources).
    if (!settings) return;
    // Auth failures stop the cadence entirely (BambooHR locks out repeated bad
    // keys); a manual Refresh re-arms the timer once it succeeds.
    if (this.#authFailed) return;
    const key = this.#clockedIn
      ? SettingsKeys.RefreshIntervalIn
      : SettingsKeys.RefreshIntervalOut;
    const seconds = Math.max(
      MIN_REFRESH_INTERVAL_SECONDS,
      settings.get_int(key),
    );
    this.#tickSource = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      seconds,
      () => {
        this.#tickSource = 0;
        // Re-render locally so durations keep ticking even if the fetch is
        // slow, then pull fresh data; #refresh re-arms this timer.
        this.#updateUi();
        void this.#refresh();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  #updateUi(): void {
    const indicator = this.#indicator;
    if (!indicator) return;
    const summary = this.#fetched
      ? summarizeToday(this.#entries, new Date())
      : null;
    // Feeds #armTimer: clocked in → fast cadence, otherwise slow.
    this.#clockedIn = summary?.clockedIn ?? false;
    indicator.update(summary, this.#lastError, {
      authPaused: this.#authFailed,
    });
  }
}
