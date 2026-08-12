import { invokeCommand, type NativeInvoke } from "../../api/commands";
import type { ImportPreviewDto } from "../../api/contracts";

export type { BackupDocumentV1, ImportPreviewDto } from "../../api/contracts";

export function createBackupApi(
  invoke: NativeInvoke = (name, input) => invokeCommand(name, input),
) {
  return {
    exportBackup: (path: string) => invoke<void>("export_backup", { path }),
    previewImport: (path: string) =>
      invoke<ImportPreviewDto>("preview_import", { path }),
    replaceFromBackup: (path: string, previewToken: string) =>
      invoke<void>("replace_from_backup", { path, previewToken }),
  };
}
