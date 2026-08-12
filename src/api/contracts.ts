export const commandErrorCodes = [
  "validation",
  "not_found",
  "shortcut_conflict",
  "clipboard_busy",
  "backup_invalid",
  "database",
  "update",
  "internal",
] as const;

export type CommandErrorCode = (typeof commandErrorCodes)[number];

export const commandErrorMessageKeys = {
  validation: "errors.validation",
  not_found: "errors.notFound",
  shortcut_conflict: "errors.shortcutConflict",
  clipboard_busy: "errors.clipboardBusy",
  backup_invalid: "errors.backupInvalid",
  database: "errors.database",
  update: "errors.update",
  internal: "errors.internal",
} as const satisfies Record<CommandErrorCode, string>;

export const commandErrorDetailFields = ["shortcut", "backup"] as const;

export interface CommandErrorDetails {
  field: (typeof commandErrorDetailFields)[number];
}

export interface CommandErrorDto {
  code: CommandErrorCode;
  messageKey: (typeof commandErrorMessageKeys)[CommandErrorCode];
  details?: CommandErrorDetails;
}

export interface ShortcutsDto {
  overlay: string;
  phrases: Record<string, string>;
}

export type ShortcutEvent =
  | { type: "copy_phrase"; phraseId: string }
  | { type: "copy_phrase_failed"; phraseId: string }
  | { type: "show_overlay"; openTemplatePhraseId: string | null };

export interface BackupLibrarySnapshot {
  games: Array<{
    id: string;
    name: string;
    sortOrder: number;
    overlayDisplayMode: "title" | "full";
  }>;
  groups: Array<{
    id: string;
    gameId: string;
    name: string;
    collapsed: boolean;
    sortOrder: number;
  }>;
  phrases: Array<{
    id: string;
    groupId: string;
    title: string;
    bodyTemplate: string;
    favorite: boolean;
    favoriteOrder: number | null;
    hotkey: string | null;
    sortOrder: number;
  }>;
  variableDefinitions: Array<{
    id: string;
    gameId: string;
    name: string;
    normalizedName: string;
    sortOrder: number;
  }>;
  variablePresets: Array<{
    id: string;
    variableDefinitionId: string;
    value: string;
    sortOrder: number;
  }>;
  phraseVariableRefs: Array<{
    phraseId: string;
    variableDefinitionId: string;
    tokenOrder: number;
  }>;
  settings: Array<{ key: string; value: string }>;
}

export interface BackupDocumentV1 {
  schemaVersion: 1;
  library: BackupLibrarySnapshot;
}

export interface ImportPreviewDto {
  previewToken: string;
  expiresAt: number;
  gameCount: number;
  groupCount: number;
  phraseCount: number;
  variableDefinitionCount: number;
  variablePresetCount: number;
  phraseVariableRefCount: number;
  shortcutConflictCount: number;
}
