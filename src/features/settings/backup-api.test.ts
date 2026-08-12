import { describe, expect, it, vi } from "vitest";
import {
  type BackupDocumentV1,
  createBackupApi,
  type ImportPreviewDto,
} from "./backup-api";

describe("backup command API", () => {
  it("exports, previews, and replaces with the exact native contracts", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    const api = createBackupApi(invoke);

    await api.exportBackup("C:/backup.json");
    await api.previewImport("C:/restore.json");
    await api.replaceFromBackup("C:/restore.json", "preview-token");

    expect(invoke.mock.calls).toEqual([
      ["export_backup", { path: "C:/backup.json" }],
      ["preview_import", { path: "C:/restore.json" }],
      [
        "replace_from_backup",
        { path: "C:/restore.json", previewToken: "preview-token" },
      ],
    ]);
  });

  it("keeps the versioned backup and non-content preview DTOs typed", () => {
    const document: BackupDocumentV1 = {
      schemaVersion: 1,
      library: {
        games: [],
        groups: [],
        phrases: [],
        variableDefinitions: [],
        variablePresets: [],
        phraseVariableRefs: [],
        settings: [],
      },
    };
    const preview: ImportPreviewDto = {
      previewToken: "token",
      expiresAt: 123,
      gameCount: 0,
      groupCount: 0,
      phraseCount: 0,
      variableDefinitionCount: 0,
      variablePresetCount: 0,
      phraseVariableRefCount: 0,
      shortcutConflictCount: 0,
    };

    expect(document.schemaVersion).toBe(1);
    expect(preview.phraseCount).toBe(0);
  });
});
