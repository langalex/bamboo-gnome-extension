import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import Pango from "gi://Pango";
import { ExtensionPreferences } from "@girs/gnome-shell/extensions/prefs";
import { storeApiKey } from "./lib/secrets.js";
import { loadSettings, SettingsKeys } from "./lib/settings.js";

function makeSpinRow(
  settings: Gio.Settings,
  key: string,
  opts: {
    title: string;
    subtitle?: string;
    min: number;
    max: number;
    step: number;
    page: number;
  },
): Adw.SpinRow {
  // GTK4 construct params reject `undefined` values, so only pass `subtitle`
  // when it was provided.
  const row = new Adw.SpinRow({
    title: opts.title,
    ...(opts.subtitle !== undefined ? { subtitle: opts.subtitle } : {}),
  });
  const adjustment = new Gtk.Adjustment({
    lower: opts.min,
    upper: opts.max,
    step_increment: opts.step,
    page_increment: opts.page,
  });
  row.set_adjustment(adjustment);
  row.set_value(settings.get_int(key));
  row.connect("changed", () => {
    settings.set_int(key, row.get_value());
  });
  return row;
}

/** Adw 1 preferences dialog bound to the extension's GSettings schema. */
export default class BambooTimesheetPreferences extends ExtensionPreferences {
  override fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = loadSettings(this.dir.get_child("schemas").get_path());

    // ---- Company page ------------------------------------------------------
    const companyPage = new Adw.PreferencesPage({
      title: "BambooHR",
      icon_name: "office-calendar-symbolic",
    });
    const companyGroup = new Adw.PreferencesGroup({
      title: "Account",
      description:
        "Your BambooHR company subdomain and a personal API key. " +
        'The domain is only the subdomain, e.g. "mycompany" for ' +
        "https://mycompany.bamboohr.com. Get the API key from BambooHR: " +
        "click your avatar in the bottom-left corner → API Keys. The key " +
        "is stored in your user keyring, never in plain-text settings.",
    });
    companyPage.add(companyGroup);
    window.add(companyPage);

    const domainRow = new Adw.EntryRow({
      title: "Company domain",
      text: settings.get_string(SettingsKeys.CompanyDomain),
    });
    // Keep the suffix hint very short: a long unbreakable label here raises
    // the row's minimum width beyond the page clamp, which pushed the boxed
    // list into the window's right margin (and squeezed the entry text) at
    // narrow window sizes. The full guidance lives in the group description,
    // which wraps freely.
    const domainHelper = new Gtk.Label({
      label: 'e.g. "mycompany"',
      ellipsize: Pango.EllipsizeMode.END,
      max_width_chars: 18,
    });
    domainHelper.add_css_class("dim-label");
    domainHelper.set_valign(Gtk.Align.CENTER);
    domainRow.add_suffix(domainHelper);
    domainRow.set_show_apply_button(true);
    domainRow.connect("apply", () => {
      settings.set_string(
        SettingsKeys.CompanyDomain,
        domainRow.get_text().trim(),
      );
    });
    companyGroup.add(domainRow);

    const apiKeyRow = new Adw.PasswordEntryRow({
      title: "API key",
    });
    // The key is never shown again once stored; this suffix keeps the only
    // visible trace of whether a keyring item exists.
    const apiKeyState = new Gtk.Label({
      label:
        settings.get_int(SettingsKeys.ApiKeyVersion) > 0
          ? "stored in keyring"
          : "not set",
      ellipsize: Pango.EllipsizeMode.END,
      max_width_chars: 16,
    });
    apiKeyState.add_css_class("dim-label");
    apiKeyState.set_valign(Gtk.Align.CENTER);
    apiKeyRow.add_suffix(apiKeyState);
    apiKeyRow.set_show_apply_button(true);
    apiKeyRow.connect("apply", () => {
      void this.#saveApiKey(window, settings, apiKeyRow, apiKeyState);
    });
    companyGroup.add(apiKeyRow);

    // ---- Preferences page --------------------------------------------------
    const prefsPage = new Adw.PreferencesPage({
      title: "Preferences",
      icon_name: "preferences-system-symbolic",
    });
    const prefsGroup = new Adw.PreferencesGroup({
      title: "Refresh",
      description:
        "The indicator is refreshed on this interval. While clocked in the " +
        "total ticks up, so a shorter interval is used.",
    });
    prefsPage.add(prefsGroup);
    window.add(prefsPage);

    prefsGroup.add(
      makeSpinRow(settings, SettingsKeys.EmployeeId, {
        title: "Employee ID",
        subtitle: "0 = detect automatically via the API key",
        min: 0,
        max: 99999999,
        step: 1,
        page: 10,
      }),
    );
    prefsGroup.add(
      makeSpinRow(settings, SettingsKeys.RefreshIntervalIn, {
        title: "Refresh while clocked in (seconds)",
        min: 15,
        max: 3600,
        step: 5,
        page: 60,
      }),
    );
    prefsGroup.add(
      makeSpinRow(settings, SettingsKeys.RefreshIntervalOut, {
        title: "Refresh while clocked out (seconds)",
        min: 30,
        max: 3600,
        step: 15,
        page: 60,
      }),
    );

    // ---- About page --------------------------------------------------------
    const aboutPage = new Adw.PreferencesPage({
      title: "About",
      icon_name: "help-about-symbolic",
    });
    const aboutGroup = new Adw.PreferencesGroup();
    aboutPage.add(aboutGroup);
    window.add(aboutPage);

    const aboutRow = new Adw.ActionRow({
      title: "BambooHR Timesheet",
      subtitle: "v0.1.0 · uses the BambooHR REST API",
    });
    aboutGroup.add(aboutRow);

    return Promise.resolve();
  }

  /**
   * Store the entered key in the keyring, then bump the GSettings version so
   * the running extension rebuilds its client without a reload. The entry is
   * cleared after a successful save so the secret does not linger on screen.
   */
  async #saveApiKey(
    window: Adw.PreferencesWindow,
    settings: Gio.Settings,
    row: Adw.PasswordEntryRow,
    state: Gtk.Label,
  ): Promise<void> {
    const apiKey = row.get_text().trim();
    if (!apiKey) return;
    try {
      await storeApiKey(this.uuid, apiKey);
      settings.set_int(
        SettingsKeys.ApiKeyVersion,
        settings.get_int(SettingsKeys.ApiKeyVersion) + 1,
      );
      row.set_text("");
      state.set_text("stored in keyring");
      window.add_toast(
        new Adw.Toast({ title: "API key saved to the keyring" }),
      );
    } catch (err) {
      window.add_toast(
        new Adw.Toast({
          title: `Saving the API key failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        }),
      );
    }
  }
}
