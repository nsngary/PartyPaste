import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  type CommandErrorCode,
  type CommandErrorDetails,
  type CommandErrorDto,
  commandErrorCodes,
  commandErrorDetailFields,
  commandErrorMessageKeys,
} from "./contracts";

export type NativeInvoke = <TOutput>(
  name: string,
  input: Record<string, unknown>,
) => Promise<TOutput>;

export class CommandError extends Error {
  readonly code: CommandErrorCode;
  readonly messageKey: CommandErrorDto["messageKey"];
  readonly details?: CommandErrorDetails;

  constructor({ code, messageKey, details }: CommandErrorDto) {
    super(messageKey);
    this.name = "CommandError";
    this.code = code;
    this.messageKey = messageKey;
    this.details = details;
  }
}

function isCommandErrorDetails(value: unknown): value is CommandErrorDetails {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const details = value as Partial<CommandErrorDetails>;
  return (
    Object.keys(details).length === 1 &&
    typeof details.field === "string" &&
    commandErrorDetailFields.includes(
      details.field as CommandErrorDetails["field"],
    )
  );
}

function isCommandErrorDto(value: unknown): value is CommandErrorDto {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<CommandErrorDto>;
  if (
    typeof candidate.code !== "string" ||
    !commandErrorCodes.includes(candidate.code as CommandErrorCode)
  ) {
    return false;
  }

  const code = candidate.code as CommandErrorCode;
  return (
    candidate.messageKey === commandErrorMessageKeys[code] &&
    (candidate.details === undefined ||
      isCommandErrorDetails(candidate.details))
  );
}

function toCommandError(error: unknown): CommandError {
  if (isCommandErrorDto(error)) {
    return new CommandError({
      code: error.code,
      messageKey: commandErrorMessageKeys[error.code],
      ...(error.details === undefined
        ? {}
        : { details: { field: error.details.field } }),
    });
  }

  return new CommandError({ code: "internal", messageKey: "errors.internal" });
}

export async function invokeCommand<
  TInput extends Record<string, unknown>,
  TOutput,
>(
  name: string,
  input: TInput,
  invoke: NativeInvoke = tauriInvoke,
): Promise<TOutput> {
  try {
    return await invoke<TOutput>(name, input);
  } catch (error) {
    throw toCommandError(error);
  }
}
