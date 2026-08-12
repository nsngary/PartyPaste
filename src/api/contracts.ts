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
  | { type: "show_overlay"; openTemplatePhraseId: string | null };
