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
import { BambooClient } from "./lib/bamboohr.js";
import { getSettings, loadSettings } from "./lib/settings.js";
import {
  formatDuration,
  formatHours,
  formatTime,
  parseIso,
  summarizeToday,
  type TodaySummary,
} from "./lib/status.js";
import type { ClockEntry } from "./lib/types.js";

/** Role under which the indicator is registered in `Main.panel.statusArea`. */
const PANEL_ROLE = "bamboo-timesheet";

/**
 * Data + label refresh cadence in seconds. Phase 5 switches this to the
 * settings-driven 60s-in / 300s-out intervals.
 */
const REFRESH_INTERVAL_SECONDS = 60;

/** Maximum characters of an error message shown in the popup header. */
const MAX_ERROR_LENGTH = 90;

/** Callbacks the indicator invokes on user interaction. */
interface IndicatorActions {
  /** Re-fetch data from the API. */
  refresh(): void;
  /** Clock in when clocked out, and vice versa. */
  toggleClock(): void;
  /** Open the BambooHR web app in the default browser. */
  openBamboo(): void;
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

    /** Re-render the panel label and the whole popup from a summary. */
    update(summary: TodaySummary | null, error: string | null): void {
      this._render(summary, error);
    }

    _render(summary: TodaySummary | null, error: string | null): void {
      // Panel label: "● Clocked in · 4h 12m" or "○ Not clocked in"; the bare
      // placeholder shows before the first fetch (or while erroring with no
      // data). The error/absent data distinction is Phase 6 polish.
      if (summary?.clockedIn) {
        this._label.set_text(
          `● Clocked in · ${formatDuration(summary.totalMs)}`,
        );
      } else if (summary) {
        this._label.set_text("○ Not clocked in");
      } else {
        this._label.set_text("○ BambooHR");
      }

      for (const cls of ["clocked-in", "clocked-out", "bamboo-error"]) {
        this.remove_style_class_name(cls);
      }
      if (error && !summary) {
        this.add_style_class_name("bamboo-error");
      } else if (summary?.clockedIn) {
        this.add_style_class_name("clocked-in");
      } else {
        this.add_style_class_name("clocked-out");
      }

      this._rebuildMenu(summary, error);
    }

    _rebuildMenu(summary: TodaySummary | null, error: string | null): void {
      const menu = this._menu;
      menu.removeAll();

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
    }
  },
);

/** GNOME 51 ESM extension entry point. */
export default class BambooTimesheetExtension extends Extension {
  #settings: Gio.Settings | null = null;
  #client: BambooClient | null = null;
  #companyDomain = "";
  #employeeId = 0;
  #indicator: InstanceType<typeof BambooIndicator> | null = null;
  #entries: ClockEntry[] = [];
  #lastError: string | null = null;
  // True once a fetch has succeeded; the popup stays in its "Refreshing…"
  // placeholder state until then.
  #fetched = false;
  #busy = false;
  #tickSource = 0;

  override enable(): void {
    const settings = loadSettings();
    const cfg = getSettings(settings);

    // Phase 6 adds a "Click to configure" indicator state.
    if (!cfg.configured) {
      console.log(
        "[bamboo-timesheet] not configured: set company domain and API key in preferences",
      );
      return;
    }

    this.#settings = settings;
    this.#companyDomain = cfg.companyDomain;
    this.#employeeId = cfg.employeeId;
    this.#client = new BambooClient({
      companyDomain: cfg.companyDomain,
      apiKey: cfg.apiKey,
    });
    this.#entries = [];
    this.#lastError = null;
    this.#fetched = false;
    this.#busy = false;

    this.#indicator = new BambooIndicator();
    this.#indicator.setActions({
      refresh: () => void this.#refresh(),
      toggleClock: () => void this.#toggleClock(),
      openBamboo: () => this.#openBamboo(),
    });
    Main.panel.addToStatusArea(PANEL_ROLE, this.#indicator);

    this.#tickSource = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      REFRESH_INTERVAL_SECONDS,
      () => {
        // Re-render locally so durations keep ticking even if the fetch is
        // slow, then pull fresh data from the API.
        this.#updateUi();
        void this.#refresh();
        return GLib.SOURCE_CONTINUE;
      },
    );

    void this.#refresh();
  }

  override disable(): void {
    if (this.#tickSource !== 0) {
      GLib.source_remove(this.#tickSource);
      this.#tickSource = 0;
    }
    // Destroying the indicator removes it from the panel and destroys the menu
    // (including all item signal connections).
    this.#indicator?.destroy();
    this.#indicator = null;
    // Cancel any in-flight request before dropping the session.
    this.#client?.abort();
    this.#client = null;
    this.#settings = null;
    this.#companyDomain = "";
    this.#employeeId = 0;
    this.#entries = [];
    this.#lastError = null;
    this.#fetched = false;
    this.#busy = false;
  }

  async #refresh(): Promise<void> {
    const client = this.#client;
    if (!client || this.#busy) return;
    this.#busy = true;
    try {
      const employeeId = await this.#resolveEmployeeId(client);
      const now = new Date();
      // A 48h window so an entry opened yesterday but still running is
      // included; "today" is then filtered per entry in the entry's timezone.
      const from = new Date(now);
      from.setDate(from.getDate() - 1);
      from.setHours(0, 0, 0, 0);
      const to = new Date(now);
      to.setDate(to.getDate() + 1);
      to.setHours(23, 59, 59, 999);

      const { data } = await client.listClockEntries(employeeId, from, to);
      this.#entries = data;
      this.#lastError = null;
      this.#fetched = true;
    } catch (err) {
      this.#lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[bamboo-timesheet] refresh failed: ${this.#lastError}`);
    } finally {
      this.#busy = false;
    }
    this.#updateUi();
  }

  async #toggleClock(): Promise<void> {
    const client = this.#client;
    if (!client || this.#busy) return;
    const clockedIn = summarizeToday(this.#entries, new Date()).clockedIn;
    this.#busy = true;
    try {
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
      Main.notifyError(
        "BambooHR",
        `Clock ${clockedIn ? "out" : "in"} failed: ${message}`,
      );
    } finally {
      this.#busy = false;
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
  async #resolveEmployeeId(client: BambooClient): Promise<number> {
    if (this.#employeeId > 0) return this.#employeeId;
    const me = await client.getSelf();
    this.#employeeId = Number(me.id) || 0;
    return this.#employeeId;
  }

  #updateUi(): void {
    const indicator = this.#indicator;
    if (!indicator) return;
    const summary = this.#fetched
      ? summarizeToday(this.#entries, new Date())
      : null;
    indicator.update(summary, this.#lastError);
  }
}
