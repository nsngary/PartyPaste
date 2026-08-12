import { invokeCommand, type NativeInvoke } from "../../api/commands";

type CommandInput = Record<string, unknown>;
type CommandCaller = <TInput extends CommandInput, TOutput>(
  name: string,
  input: TInput,
) => Promise<TOutput>;

export interface GameDto {
  id: string;
  name: string;
  sortOrder: number;
  overlayDisplayMode: "title" | "full";
}

export interface GroupDto {
  id: string;
  gameId: string;
  name: string;
  collapsed: boolean;
  sortOrder: number;
}

export interface PhraseDto {
  id: string;
  groupId: string;
  title: string;
  bodyTemplate: string;
  favorite: boolean;
  favoriteOrder: number | null;
  hotkey: string | null;
  sortOrder: number;
}

export interface LibrarySnapshot {
  games: GameDto[];
  groups: GroupDto[];
  phrases: PhraseDto[];
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

export interface UndoReceipt {
  operationId: string;
  expiresAt: number;
}

export interface MutationResult<T> {
  value: T;
  undo: UndoReceipt;
}

export interface GameDeleteImpact {
  groupCount: number;
  phraseCount: number;
  variableDefinitionCount: number;
  variablePresetCount: number;
  phraseVariableRefCount: number;
}

export interface GroupDeleteImpact {
  phraseCount: number;
  phraseVariableRefCount: number;
}

export interface SaveVariableDefinitionInput extends CommandInput {
  input: {
    id: string;
    gameId: string;
    name: string;
    sortOrder: number;
    renameConfirmed: boolean;
    presets: Array<{ id: string; value: string; sortOrder: number }>;
  };
}

export interface VariableDefinitionWithPresets {
  definition: LibrarySnapshot["variableDefinitions"][number];
  presets: LibrarySnapshot["variablePresets"];
}

export type SaveVariableCommandResult =
  | { status: "saved"; value: LibrarySnapshot; undo: UndoReceipt }
  | {
      status: "rename_confirmation_required";
      affectedPhraseCount: number;
      affectedTokenCount: number;
    };

export interface CreateGameInput extends CommandInput {
  input: { id: string; name: string };
}

export interface UpdateGameInput extends CommandInput {
  input: { id: string; name: string };
}

export interface CreateGroupInput extends CommandInput {
  input: { id: string; gameId: string; name: string };
}

export interface UpdateGroupInput extends CommandInput {
  input: { id: string; name: string; collapsed: boolean };
}

export interface CreatePhraseInput extends CommandInput {
  input: {
    id: string;
    groupId: string;
    title: string;
    bodyTemplate: string;
    hotkey?: string | null;
  };
}

export interface UpdatePhraseInput extends CommandInput {
  input: {
    id: string;
    title: string;
    bodyTemplate: string;
    hotkey: string | null;
  };
}

export function createLibraryApi(
  invoke: NativeInvoke = (name, input) => invokeCommand(name, input),
) {
  const call: CommandCaller = (name, input) => invoke(name, input);
  return {
    getLibrary: () =>
      call<Record<string, never>, LibrarySnapshot>("get_library", {}),
    createGame: (input: CreateGameInput) =>
      call<CreateGameInput, MutationResult<GameDto>>("create_game", input),
    updateGame: (input: UpdateGameInput) =>
      call<UpdateGameInput, MutationResult<GameDto>>("update_game", input),
    setOverlayDisplayMode: (input: {
      gameId: string;
      displayMode: GameDto["overlayDisplayMode"];
    }) => call<typeof input, GameDto>("set_overlay_display_mode", input),
    deleteGame: (input: { gameId: string }) =>
      call<typeof input, MutationResult<LibrarySnapshot>>("delete_game", input),
    createGroup: (input: CreateGroupInput) =>
      call<CreateGroupInput, MutationResult<GroupDto>>("create_group", input),
    updateGroup: (input: UpdateGroupInput) =>
      call<UpdateGroupInput, MutationResult<GroupDto>>("update_group", input),
    deleteGroup: (input: { groupId: string }) =>
      call<typeof input, MutationResult<LibrarySnapshot>>(
        "delete_group",
        input,
      ),
    createPhrase: (input: CreatePhraseInput) =>
      call<CreatePhraseInput, MutationResult<LibrarySnapshot>>(
        "create_phrase",
        input,
      ),
    updatePhrase: (input: UpdatePhraseInput) =>
      call<UpdatePhraseInput, MutationResult<LibrarySnapshot>>(
        "update_phrase",
        input,
      ),
    deletePhrase: (input: { phraseId: string }) =>
      call<typeof input, MutationResult<LibrarySnapshot>>(
        "delete_phrase",
        input,
      ),
    duplicatePhrase: (input: { phraseId: string; newPhraseId: string }) =>
      call<typeof input, MutationResult<LibrarySnapshot>>(
        "duplicate_phrase",
        input,
      ),
    movePhrase: (input: {
      phraseId: string;
      targetGroupId: string;
      targetIndex: number;
    }) =>
      call<typeof input, MutationResult<LibrarySnapshot>>("move_phrase", input),
    reorderGames: (input: { orderedIds: string[] }) =>
      call<typeof input, MutationResult<LibrarySnapshot>>(
        "reorder_games",
        input,
      ),
    reorderGroups: (input: { gameId: string; orderedIds: string[] }) =>
      call<typeof input, MutationResult<LibrarySnapshot>>(
        "reorder_groups",
        input,
      ),
    reorderPhrases: (input: { groupId: string; orderedIds: string[] }) =>
      call<typeof input, MutationResult<LibrarySnapshot>>(
        "reorder_phrases",
        input,
      ),
    reorderFavorites: (input: { gameId: string; orderedIds: string[] }) =>
      call<typeof input, MutationResult<LibrarySnapshot>>(
        "reorder_favorites",
        input,
      ),
    reorderVariableDefinitions: (input: {
      gameId: string;
      orderedIds: string[];
    }) =>
      call<typeof input, MutationResult<LibrarySnapshot>>(
        "reorder_variable_definitions",
        input,
      ),
    setFavorite: (input: { phraseId: string; favorite: boolean }) =>
      call<typeof input, MutationResult<LibrarySnapshot>>(
        "set_favorite",
        input,
      ),
    searchPhrases: (input: { gameId: string; query: string }) =>
      call<typeof input, PhraseDto[]>("search_phrases", input),
    undoOperation: (input: { operationId: string }) =>
      call<typeof input, LibrarySnapshot>("undo_operation", input),
    getGameDeleteImpact: (input: { gameId: string }) =>
      call<typeof input, GameDeleteImpact>("get_game_delete_impact", input),
    getGroupDeleteImpact: (input: { groupId: string }) =>
      call<typeof input, GroupDeleteImpact>("get_group_delete_impact", input),
    listVariableDefinitions: (input: { gameId: string }) =>
      call<typeof input, VariableDefinitionWithPresets[]>(
        "list_variable_definitions",
        input,
      ),
    saveVariableDefinition: (input: SaveVariableDefinitionInput) =>
      call<SaveVariableDefinitionInput, SaveVariableCommandResult>(
        "save_variable_definition",
        input,
      ),
    reorderVariablePresets: (input: {
      variableDefinitionId: string;
      orderedIds: string[];
    }) =>
      call<typeof input, MutationResult<LibrarySnapshot>>(
        "reorder_variable_presets",
        input,
      ),
    deleteVariableDefinition: (input: { variableDefinitionId: string }) =>
      call<typeof input, MutationResult<LibrarySnapshot>>(
        "delete_variable_definition",
        input,
      ),
  };
}
