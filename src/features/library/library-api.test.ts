import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createLibraryApi, type LibrarySnapshot } from "./library-api";

describe("library command API", () => {
  it.each([
    ["createGame", "create_game", { input: { id: "g", name: "Game" } }],
    ["updateGame", "update_game", { input: { id: "g", name: "Renamed" } }],
    ["deleteGame", "delete_game", { gameId: "g" }],
    [
      "createGroup",
      "create_group",
      { input: { id: "r", gameId: "g", name: "Raid" } },
    ],
    [
      "updateGroup",
      "update_group",
      { input: { id: "r", name: "Party", collapsed: true } },
    ],
    ["deleteGroup", "delete_group", { groupId: "r" }],
    [
      "createPhrase",
      "create_phrase",
      { input: { id: "p", groupId: "r", title: "T", bodyTemplate: "B" } },
    ],
    [
      "updatePhrase",
      "update_phrase",
      { input: { id: "p", title: "T2", bodyTemplate: "B2", hotkey: null } },
    ],
    ["deletePhrase", "delete_phrase", { phraseId: "p" }],
    [
      "duplicatePhrase",
      "duplicate_phrase",
      { phraseId: "p", newPhraseId: "p2" },
    ],
    [
      "movePhrase",
      "move_phrase",
      { phraseId: "p", targetGroupId: "r2", targetIndex: 0 },
    ],
    ["reorderGames", "reorder_games", { orderedIds: ["g2", "g"] }],
    [
      "reorderGroups",
      "reorder_groups",
      { gameId: "g", orderedIds: ["r2", "r"] },
    ],
    [
      "reorderPhrases",
      "reorder_phrases",
      { groupId: "r", orderedIds: ["p2", "p"] },
    ],
    [
      "reorderFavorites",
      "reorder_favorites",
      { gameId: "g", orderedIds: ["p2", "p"] },
    ],
    [
      "reorderVariableDefinitions",
      "reorder_variable_definitions",
      { gameId: "g", orderedIds: ["v2", "v1"] },
    ],
    ["setFavorite", "set_favorite", { phraseId: "p", favorite: true }],
    ["searchPhrases", "search_phrases", { gameId: "g", query: "raid" }],
    ["undoOperation", "undo_operation", { operationId: "op" }],
    ["getGameDeleteImpact", "get_game_delete_impact", { gameId: "g" }],
    ["getGroupDeleteImpact", "get_group_delete_impact", { groupId: "r" }],
    ["listVariableDefinitions", "list_variable_definitions", { gameId: "g" }],
    [
      "saveVariableDefinition",
      "save_variable_definition",
      {
        input: {
          id: "v",
          gameId: "g",
          name: "Count",
          sortOrder: 0,
          renameConfirmed: false,
          presets: [],
        },
      },
    ],
    [
      "reorderVariablePresets",
      "reorder_variable_presets",
      { variableDefinitionId: "v", orderedIds: ["p2", "p1"] },
    ],
    [
      "deleteVariableDefinition",
      "delete_variable_definition",
      { variableDefinitionId: "v" },
    ],
  ] as const)(
    "%s invokes %s with typed input",
    async (method, command, input) => {
      const invoke = vi.fn().mockResolvedValue({ ok: true });
      const api = createLibraryApi(invoke);
      await (api[method] as (input: never) => Promise<unknown>)(input as never);
      expect(invoke).toHaveBeenCalledWith(command, input);
    },
  );

  it("loads the complete snapshot without a fake scope argument", async () => {
    const invoke = vi.fn().mockResolvedValue({ games: [] });
    const api = createLibraryApi(invoke);
    await api.getLibrary();
    expect(invoke).toHaveBeenCalledWith("get_library", {});
  });

  it("types phrase mutations as complete snapshot responses", () => {
    const api = createLibraryApi(vi.fn());
    expectTypeOf(api.createPhrase).returns.resolves.toMatchTypeOf<{
      value: LibrarySnapshot;
    }>();
    expectTypeOf(api.updatePhrase).returns.resolves.toMatchTypeOf<{
      value: LibrarySnapshot;
    }>();
  });
});
