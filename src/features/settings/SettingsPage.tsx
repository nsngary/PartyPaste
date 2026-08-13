import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invokeCommand, type NativeInvoke } from "../../api/commands";
import { SegmentedControl } from "../../components/SegmentedControl";
import { type SupportedLocale, setPartyPasteLocale } from "../../i18n";
import { AboutPage } from "./AboutPage";
import {
  type BackupFileDialog,
  BackupSettings,
  type BackupSettingsApi,
} from "./BackupSettings";
import { ShortcutSettings, type ShortcutSettingsApi } from "./ShortcutSettings";
import { UpdateSettings } from "./UpdateSettings";

export interface WindowSettingsDto {
  alwaysOnTop: boolean;
}

export interface WindowSettingsApi {
  getWindowSettings(): Promise<WindowSettingsDto>;
  toggleTopmost(enabled: boolean): Promise<boolean>;
}

export function createWindowSettingsApi(
  invoke: NativeInvoke = (name, input) => invokeCommand(name, input),
): WindowSettingsApi {
  return {
    getWindowSettings: () =>
      invoke<WindowSettingsDto>("get_window_settings", {}),
    toggleTopmost: (alwaysOnTop) =>
      invoke<boolean>("toggle_topmost", { alwaysOnTop }),
  };
}

export interface SettingsPageProps {
  backupApi?: BackupSettingsApi;
  fileDialog?: BackupFileDialog;
  settingsApi?: WindowSettingsApi;
  shortcutApi?: ShortcutSettingsApi;
}

const defaultWindowSettingsApi = createWindowSettingsApi();

export function SettingsPage({
  backupApi,
  fileDialog,
  settingsApi = defaultWindowSettingsApi,
  shortcutApi,
}: SettingsPageProps) {
  const { i18n, t } = useTranslation();
  const locale: SupportedLocale = i18n.language === "en" ? "en" : "zh-TW";
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [preferenceError, setPreferenceError] = useState(false);

  useEffect(() => {
    let active = true;
    void settingsApi
      .getWindowSettings()
      .then((settings) => {
        if (active) setAlwaysOnTop(settings.alwaysOnTop);
      })
      .catch(() => {
        if (active) setPreferenceError(true);
      });
    return () => {
      active = false;
    };
  }, [settingsApi]);

  async function changeTopmost(enabled: boolean) {
    const previous = alwaysOnTop;
    setAlwaysOnTop(enabled);
    setPreferenceError(false);
    try {
      setAlwaysOnTop(await settingsApi.toggleTopmost(enabled));
    } catch {
      setAlwaysOnTop(previous);
      setPreferenceError(true);
    }
  }

  return (
    <div className="pp-settings">
      <header className="pp-settings__header">
        <h1>{t("settings.title")}</h1>
      </header>
      <section
        className="pp-settings__section"
        aria-labelledby="settings-general"
      >
        <h2 id="settings-general">{t("settings.general")}</h2>
        <div className="pp-settings__row">
          <div>
            <strong>{t("settings.language.label")}</strong>
            <p>{t("settings.language.description")}</p>
          </div>
          <SegmentedControl
            ariaLabel={t("settings.language.label")}
            onChange={(next) => void setPartyPasteLocale(i18n, next)}
            options={[
              {
                label: t("settings.language.traditionalChinese"),
                value: "zh-TW",
              },
              { label: t("settings.language.english"), value: "en" },
            ]}
            value={locale}
          />
        </div>
        <label className="pp-settings__checkbox">
          <input
            aria-label={t("overlay.alwaysOnTop")}
            checked={alwaysOnTop}
            onChange={(event) => void changeTopmost(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>{t("overlay.alwaysOnTop")}</strong>
            <span>{t("settings.topmostDescription")}</span>
          </span>
        </label>
        {preferenceError ? (
          <p role="alert">{t("overlay.preferenceSaveFailed")}</p>
        ) : null}
      </section>
      <ShortcutSettings api={shortcutApi} />
      <BackupSettings api={backupApi} fileDialog={fileDialog} />
      <UpdateSettings />
      <AboutPage />
    </div>
  );
}
