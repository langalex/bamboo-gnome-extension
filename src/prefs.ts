import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import { ExtensionPreferences } from "@girs/gnome-shell/extensions/prefs";
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
  const row = new Adw.SpinRow({
    title: opts.title,
    subtitle: opts.subtitle,
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
    const settings = loadSettings();

    // ---- Company page ------------------------------------------------------
    const companyPage = new Adw.PreferencesPage({
      title: "BambooHR",
      icon_name: "office-calendar-symbolic",
    });
    const companyGroup = new Adw.PreferencesGroup({
      title: "Account",
      description:
        "Your BambooHR company subdomain and a personal API key. " +
        "Get the key from BambooHR: click your avatar in the bottom-left " +
        "corner → API Keys. The key is stored as plain text in GSettings.",
    });
    companyPage.add(companyGroup);
    window.add(companyPage);

    const domainRow = new Adw.EntryRow({
      title: "Company domain",
      text: settings.get_string(SettingsKeys.CompanyDomain),
    });
    const domainHelper = new Gtk.Label({
      label:
        'Only the subdomain, e.g. "mycompany" for https://mycompany.bamboohr.com',
    });
    domainHelper.add_css_class("dim-label");
    domainRow.add_suffix(domainHelper);
    domainRow.set_show_apply_button(true);
    domainRow.connect("apply", () => {
      settings.set_string(
        SettingsKeys.CompanyDomain,
        domainRow.get_text().trim(),
      );
    });
    companyGroup.add(domainRow);

    const apiKeyRow = new Adw.EntryRow({
      title: "API key",
      text: settings.get_string(SettingsKeys.ApiKey),
    });
    apiKeyRow.set_show_apply_button(true);
    apiKeyRow.connect("apply", () => {
      settings.set_string(SettingsKeys.ApiKey, apiKeyRow.get_text().trim());
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
}
