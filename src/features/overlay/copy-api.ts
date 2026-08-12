import { invokeCommand, type NativeInvoke } from "../../api/commands";

type CommandInput = Record<string, unknown>;
type CommandCaller = <TInput extends CommandInput, TOutput>(
  name: string,
  input: TInput,
) => Promise<TOutput>;

export interface CopyPhraseInput extends CommandInput {
  phraseId: string;
  variables: Record<string, string>;
}

export interface RecentCopyDto {
  phraseId: string;
  title: string;
  resolvedAt: number;
  resolvedText: string;
}

export type CopySuccessDto = RecentCopyDto;

export function createCopyApi(
  invoke: NativeInvoke = (name, input) => invokeCommand(name, input),
) {
  const call: CommandCaller = (name, input) => invoke(name, input);
  return {
    copyPhrase: (input: CopyPhraseInput) =>
      call<CopyPhraseInput, CopySuccessDto>("copy_phrase", input),
    getRecentCopies: () =>
      call<Record<string, never>, RecentCopyDto[]>("get_recent_copies", {}),
  };
}
