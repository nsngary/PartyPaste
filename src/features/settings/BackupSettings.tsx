import { open, save } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { createBackupApi, type ImportPreviewDto } from "./backup-api";

export interface BackupSettingsApi {
  exportBackup(path: string): Promise<void>;
  previewImport(path: string): Promise<ImportPreviewDto>;
  replaceFromBackup(path: string, previewToken: string): Promise<void>;
}

export interface BackupFileDialog {
  openBackup(): Promise<string | null>;
  saveBackup(): Promise<string | null>;
}

export const nativeBackupFileDialog: BackupFileDialog = {
  async openBackup() {
    const selected = await open({
      directory: false,
      multiple: false,
      filters: [{ name: "PartyPaste JSON", extensions: ["json"] }],
    });
    return typeof selected === "string" ? selected : null;
  },
  async saveBackup() {
    return save({
      defaultPath: "partypaste-backup.json",
      filters: [{ name: "PartyPaste JSON", extensions: ["json"] }],
    });
  },
};

export interface BackupSettingsProps {
  api?: BackupSettingsApi;
  fileDialog?: BackupFileDialog;
}

type Confirmation = "export" | "replace" | null;
const defaultBackupApi = createBackupApi();

export function BackupSettings({
  api = defaultBackupApi,
  fileDialog = nativeBackupFileDialog,
}: BackupSettingsProps) {
  const { t } = useTranslation();
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function requestExport() {
    setError(null);
    setStatus(null);
    try {
      const selected = await fileDialog.saveBackup();
      if (selected) {
        setExportPath(selected);
        setConfirmation("export");
      }
    } catch {
      setError(t("settings.fileSelectionFailed"));
    }
  }

  async function confirmExport() {
    if (!exportPath) return;
    setBusy(true);
    try {
      await api.exportBackup(exportPath);
      setConfirmation(null);
      setExportPath(null);
      setStatus(t("settings.backupExported"));
    } catch {
      setConfirmation(null);
      setExportPath(null);
      setError(t("settings.backupFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function requestImport() {
    setError(null);
    setStatus(null);
    try {
      const selected = await fileDialog.openBackup();
      if (!selected) return;
      setBusy(true);
      const nextPreview = await api.previewImport(selected);
      setImportPath(selected);
      setPreview(nextPreview);
    } catch {
      setImportPath(null);
      setPreview(null);
      setError(t("settings.backupInvalid"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmReplacement() {
    if (!importPath || !preview) return;
    setBusy(true);
    try {
      await api.replaceFromBackup(importPath, preview.previewToken);
      setConfirmation(null);
      setImportPath(null);
      setPreview(null);
      setStatus(t("settings.backupRestored"));
    } catch {
      setConfirmation(null);
      setImportPath(null);
      setPreview(null);
      setError(t("settings.backupFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pp-settings__section" aria-labelledby="settings-backup">
      <h2 id="settings-backup">{t("settings.backup")}</h2>
      <p>{t("settings.backupDescription")}</p>
      <div className="pp-settings__actions">
        <Button
          disabled={busy}
          onClick={() => void requestExport()}
          variant="secondary"
        >
          {t("settings.exportBackup")}
        </Button>
        <Button
          disabled={busy}
          loading={busy}
          loadingLabel={t("settings.readingBackup")}
          onClick={() => void requestImport()}
          variant="secondary"
        >
          {t("settings.importBackup")}
        </Button>
      </div>
      {preview ? (
        <div className="pp-backup-preview">
          <h3>{t("settings.importPreview")}</h3>
          <p>
            {t("settings.importCounts", {
              gameCount: preview.gameCount,
              groupCount: preview.groupCount,
              phraseCount: preview.phraseCount,
            })}
          </p>
          <p>
            {t("settings.shortcutConflictCount", {
              count: preview.shortcutConflictCount,
            })}
          </p>
          <Button onClick={() => setConfirmation("replace")} variant="danger">
            {t("settings.replaceLibrary")}
          </Button>
        </div>
      ) : null}
      {status ? <p role="status">{status}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <Dialog
        description={
          confirmation === "replace"
            ? t("settings.replaceWarning")
            : t("settings.exportConfirmationDescription")
        }
        footer={
          <>
            <Button onClick={() => setConfirmation(null)} variant="secondary">
              {t("common.cancel")}
            </Button>
            <Button
              loading={busy}
              loadingLabel={t("settings.savingBackup")}
              onClick={() =>
                void (confirmation === "replace"
                  ? confirmReplacement()
                  : confirmExport())
              }
              variant={confirmation === "replace" ? "danger" : "primary"}
            >
              {t(
                confirmation === "replace"
                  ? "settings.confirmReplacement"
                  : "settings.confirmExport",
              )}
            </Button>
          </>
        }
        onClose={() => setConfirmation(null)}
        open={confirmation !== null}
        title={
          confirmation === "replace"
            ? t("settings.confirmReplacement")
            : t("settings.confirmExport")
        }
      >
        <p>
          {confirmation === "replace"
            ? t("settings.replaceConfirmationBody")
            : t("settings.exportConfirmationBody")}
        </p>
      </Dialog>
    </section>
  );
}
