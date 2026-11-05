import GLib from "gi://GLib";
import { Extension } from "@girs/gnome-shell/extensions/extension";
import { BambooClient, BambooApiError } from "./lib/bamboohr.js";
import { loadSettings, getSettings } from "./lib/settings.js";
import { summarizeToday } from "./lib/status.js";

/** GNOME 51 ESM extension entry point. */
export default class BambooTimesheetExtension extends Extension {
  override enable(): void {
    const settings = loadSettings();
    const cfg = getSettings(settings);

    // Log a clear message when not configured; UI states come in Phase 4.
    if (!cfg.configured) {
      console.log(
        "[bamboo-timesheet] not configured: set company domain and API key in preferences",
      );
      return;
    }

    const client = new BambooClient({
      companyDomain: cfg.companyDomain,
      apiKey: cfg.apiKey,
    });

    // Live smoke test of the API wiring (replaced by the indicator in Phase 4).
    void this.#probe(client, cfg.employeeId);
  }

  override disable(): void {
    // Phase 5: tear down indicators, timers, and signal handlers
  }

  /** Fetch self + today's entries and log a summary (temp until Phase 4 UI). */
  async #probe(client: BambooClient, employeeId: number): Promise<void> {
    try {
      const me = await client.getSelf();
      const id = employeeId > 0 ? employeeId : Number(me.id) || 0;
      console.log(
        `[bamboo-timesheet] authenticated as employee ${id} (${me.displayName ?? me.preferredName ?? me.firstName ?? ""})`,
      );

      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - 1);
      const to = new Date(now);
      to.setDate(to.getDate() + 1);
      to.setHours(23, 59, 59, 999);

      const { data } = await client.listClockEntries(id, from, to);
      const summary = summarizeToday(data, now);
      console.log(
        `[bamboo-timesheet] clockedIn=${summary.clockedIn} totalToday=${summary.totalMs}ms entries=${summary.entries.length}`,
      );
    } catch (err) {
      if (err instanceof BambooApiError) {
        console.warn(
          `[bamboo-timesheet] API error (${err.status}): ${err.message}`,
        );
      } else {
        console.warn(`[bamboo-timesheet] error: ${String(err)}`);
      }
    }
  }
}
