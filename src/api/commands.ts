import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  type CommandErrorCode,
  type CommandErrorDto,
  commandErrorCodes,
} from "./contracts";

export type NativeInvoke = <TOutput>(
  name: string,
  input: Record<string, unknown>,
) => Promise<TOutput>;

export class CommandError extends Error {
  readonly code: CommandErrorCode;
  readonly messageKey: string;
  readonly details?: Record<string, string>;

  constructor({ code, messageKey, details }: CommandErrorDto) {
    super(messageKey);
    this.name = "CommandError";
    this.code = code;
    this.messageKey = messageKey;
    this.details = details;
  }
}

function isCommandErrorDto(value: unknown): value is CommandErrorDto {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<CommandErrorDto>;
  return (
    typeof candidate.messageKey === "string" &&
    typeof candidate.code === "string" &&
    commandErrorCodes.includes(candidate.code as CommandErrorCode)
  );
}

function toCommandError(error: unknown): CommandError {
  if (isCommandErrorDto(error)) {
    return new CommandError(error);
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
