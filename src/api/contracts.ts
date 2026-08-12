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

export interface CommandErrorDto {
  code: CommandErrorCode;
  messageKey: string;
  details?: Record<string, string>;
}
