import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invokeCommand, type NativeInvoke } from "../../api/commands";
import type { ShortcutsDto } from "../../api/contracts";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { normalizeShortcut, shortcutValidationError } from "./shortcut-model";

export interface ShortcutSettingsApi {
  getShortcuts(): Promise<ShortcutsDto>;
  setOverlayShortcut(shortcut: string): Promise<ShortcutsDto>;
}

export function createShortcutSettingsApi(
  invoke: NativeInvoke = (name, input) => invokeCommand(name, input),
): ShortcutSettingsApi {
  return {
    getShortcuts: () => invoke<ShortcutsDto>("get_shortcuts", {}),
    setOverlayShortcut: (shortcut) =>
      invoke<ShortcutsDto>("set_overlay_shortcut", { shortcut }),
  };
}

const defaultShortcutSettingsApi = createShortcutSettingsApi();

export interface ShortcutSettingsProps {
  api?: ShortcutSettingsApi;
}

export function ShortcutSettings({
  api = defaultShortcutSettingsApi,
}: ShortcutSettingsProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [confirmed, setConfirmed] = useState("");
  const [phraseShortcuts, setPhraseShortcuts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .getShortcuts()
      .then((shortcuts) => {
        if (!active) return;
        setValue(shortcuts.overlay);
        setConfirmed(shortcuts.overlay);
        setPhraseShortcuts(Object.values(shortcuts.phrases));
      })
      .catch(() => {
        if (active) setError(t("settings.shortcutLoadFailed"));
      });
    return () => {
      active = false;
    };
  }, [api, t]);

  async function save() {
    const normalized = normalizeShortcut(value);
    const validation = shortcutValidationError(normalized, phraseShortcuts);
    if (validation) {
      setError(
        t(
          validation === "modifier_required"
            ? "settings.shortcutModifierRequired"
            : "settings.shortcutConflict",
        ),
      );
      setValue(confirmed);
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const shortcuts = await api.setOverlayShortcut(normalized);
      setValue(shortcuts.overlay);
      setConfirmed(shortcuts.overlay);
      setPhraseShortcuts(Object.values(shortcuts.phrases));
      setSaved(true);
    } catch {
      setValue(confirmed);
      setError(t("settings.shortcutConflict"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="pp-settings__section"
      aria-labelledby="settings-shortcuts"
    >
      <h2 id="settings-shortcuts">{t("settings.shortcuts")}</h2>
      <Field
        description={t("settings.shortcutDescription")}
        error={error ? <span role="alert">{error}</span> : undefined}
        label={t("settings.overlayShortcut")}
      >
        <input
          autoCapitalize="off"
          autoComplete="off"
          className="pp-shortcut-input"
          onChange={(event) => {
            setValue(event.target.value);
            setSaved(false);
          }}
          spellCheck={false}
          value={value}
        />
      </Field>
      <div className="pp-settings__actions">
        <Button
          loading={saving}
          loadingLabel={t("settings.savingShortcut")}
          onClick={() => void save()}
        >
          {t("settings.saveShortcut")}
        </Button>
        {saved ? (
          <span role="status">{t("settings.shortcutSaved")}</span>
        ) : null}
      </div>
    </section>
  );
}
