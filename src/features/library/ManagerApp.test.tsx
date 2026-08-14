import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createPartyPasteI18n } from "../../i18n";
import type { LibrarySnapshot } from "./library-api";
import { ManagerApp, type ManagerLibraryApi } from "./ManagerApp";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const baseSnapshot: LibrarySnapshot = {
  games: [
    {
      id: "game-1",
      name: "Guild Wars",
      sortOrder: 0,
      overlayDisplayMode: "title",
    },
  ],
  groups: [
    {
      id: "group-1",
      gameId: "game-1",
      name: "Raids",
      collapsed: false,
      sortOrder: 0,
    },
    {
      id: "group-2",
      gameId: "game-1",
      name: "Trading",
      collapsed: false,
      sortOrder: 1,
    },
  ],
  phrases: [
    {
      id: "plain",
      groupId: "group-1",
      title: "Ready",
      bodyTemplate: "Ready now",
      favorite: true,
      favoriteOrder: 0,
      hotkey: null,
      sortOrder: 0,
    },
    {
      id: "template",
      groupId: "group-1",
      title: "Invite",
      bodyTemplate: "Need {count}",
      favorite: false,
      favoriteOrder: null,
      hotkey: "Ctrl+1",
      sortOrder: 1,
    },
  ],
  variableDefinitions: [],
  variablePresets: [],
  phraseVariableRefs: [],
  settings: [],
};

function mutation(value: LibrarySnapshot = baseSnapshot) {
  return {
    value,
    undo: { operationId: "undo-1", expiresAt: Date.now() + 10_000 },
  };
}

function makeApi(
  overrides: Partial<ManagerLibraryApi> = {},
): ManagerLibraryApi {
  return {
    getLibrary: vi.fn().mockResolvedValue(baseSnapshot),
    createGame: vi.fn().mockResolvedValue(mutation()),
    updateGame: vi.fn().mockResolvedValue(mutation()),
    deleteGame: vi.fn().mockResolvedValue(mutation()),
    getGameDeleteImpact: vi.fn().mockResolvedValue({
      groupCount: 2,
      phraseCount: 7,
      variableDefinitionCount: 3,
      variablePresetCount: 8,
      phraseVariableRefCount: 4,
    }),
    reorderGames: vi.fn().mockResolvedValue(mutation()),
    createGroup: vi.fn().mockResolvedValue(mutation()),
    updateGroup: vi.fn().mockResolvedValue(mutation()),
    deleteGroup: vi.fn().mockResolvedValue(mutation()),
    getGroupDeleteImpact: vi
      .fn()
      .mockResolvedValue({ phraseCount: 2, phraseVariableRefCount: 1 }),
    reorderGroups: vi.fn().mockResolvedValue(mutation()),
    createPhrase: vi.fn().mockResolvedValue(mutation()),
    updatePhrase: vi.fn().mockResolvedValue(mutation()),
    deletePhrase: vi.fn().mockResolvedValue(mutation()),
    duplicatePhrase: vi.fn().mockResolvedValue(mutation()),
    movePhrase: vi.fn().mockResolvedValue(mutation()),
    reorderPhrases: vi.fn().mockResolvedValue(mutation()),
    reorderFavorites: vi.fn().mockResolvedValue(mutation()),
    setFavorite: vi.fn().mockResolvedValue(mutation()),
    searchPhrases: vi.fn().mockResolvedValue([baseSnapshot.phrases[1]]),
    undoOperation: vi.fn().mockResolvedValue(baseSnapshot),
    listVariableDefinitions: vi.fn().mockResolvedValue([]),
    saveVariableDefinition: vi.fn(),
    reorderVariableDefinitions: vi.fn().mockResolvedValue(mutation()),
    reorderVariablePresets: vi.fn().mockResolvedValue(mutation()),
    deleteVariableDefinition: vi.fn().mockResolvedValue(mutation()),
    ...overrides,
  };
}

function renderManager(api = makeApi(), width = 1440, locale = "en") {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <AppProviders i18n={createPartyPasteI18n(locale)}>
      <QueryClientProvider client={queryClient}>
        <ManagerApp libraryApi={api} />
      </QueryClientProvider>
    </AppProviders>,
  );
  return { ...result, api };
}

describe("manager workflows", () => {
  it("creates the first game when the library is empty", async () => {
    const user = userEvent.setup();
    const emptySnapshot: LibrarySnapshot = {
      ...baseSnapshot,
      games: [],
      groups: [],
      phrases: [],
    };
    const api = makeApi({
      getLibrary: vi.fn().mockResolvedValue(emptySnapshot),
    });
    renderManager(api);

    const newGameButtons = await screen.findAllByRole("button", {
      name: "New game",
    });
    await user.click(newGameButtons[0]);
    await user.type(
      screen.getByRole("textbox", { name: "Game name" }),
      "MapleStory",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(api.createGame).toHaveBeenCalledWith({
      input: expect.objectContaining({ name: "MapleStory" }),
    });
  });

  it("debounces native search and combines favorites, template, and shortcut filters", async () => {
    const api = makeApi();
    renderManager(api);
    await screen.findByText("Ready");
    vi.useFakeTimers();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "inv" },
    });
    expect(api.searchPhrases).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(249);
    expect(api.searchPhrases).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    expect(api.searchPhrases).toHaveBeenCalledWith({
      gameId: "game-1",
      query: "inv",
    });
    expect(screen.getByText("Invite")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "Favorites" }));
    expect(screen.queryByText("Invite")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Favorites" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Templates" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Shortcuts" }));
    expect(screen.getByText("Invite")).toBeTruthy();
  });

  it("creates and edits games and groups, confirms child counts, then offers Undo for ten seconds", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    renderManager(api);
    await screen.findByText("Guild Wars");
    await user.click(screen.getByRole("button", { name: "New game" }));
    await user.type(
      screen.getByRole("textbox", { name: "Game name" }),
      "Monster Hunter",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(api.createGame).toHaveBeenCalledWith({
      input: expect.objectContaining({ name: "Monster Hunter" }),
    });

    await user.click(
      screen.getByRole("button", { name: "Edit game Guild Wars" }),
    );
    const gameName = screen.getByRole("textbox", { name: "Game name" });
    await user.clear(gameName);
    await user.type(gameName, "Guild Wars 2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(api.updateGame).toHaveBeenCalledWith({
      input: { id: "game-1", name: "Guild Wars 2" },
    });

    await user.click(screen.getByRole("button", { name: "New group" }));
    await user.type(
      screen.getByRole("textbox", { name: "Group name" }),
      "Open world",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(api.createGroup).toHaveBeenCalledWith({
      input: expect.objectContaining({ gameId: "game-1", name: "Open world" }),
    });

    await user.click(
      screen.getByRole("button", { name: "Delete game Guild Wars" }),
    );
    expect(
      (await screen.findByRole("dialog", { name: "Delete game" })).textContent,
    ).toContain("2 groups");
    expect(
      screen.getByRole("dialog", { name: "Delete game" }).textContent,
    ).toContain("7 phrases");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.deleteGame).toHaveBeenCalledWith({ gameId: "game-1" });
    const undo = await screen.findByRole("button", { name: "Undo" });
    await user.click(undo);
    expect(api.undoOperation).toHaveBeenCalledWith({ operationId: "undo-1" });
  });

  it("creates, edits, duplicates, favorites, moves, and deletes a phrase", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    renderManager(api);
    await screen.findByText("Ready");
    await user.click(
      screen.getByRole("button", { name: "New phrase in Raids" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Phrase title" }),
      "Stack",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Phrase body" }),
      "Stack on me",
    );
    await user.click(screen.getByRole("button", { name: "Save phrase" }));
    expect(api.createPhrase).toHaveBeenCalledWith({
      input: expect.objectContaining({
        groupId: "group-1",
        title: "Stack",
        bodyTemplate: "Stack on me",
      }),
    });

    await user.click(screen.getByRole("button", { name: "Edit Ready" }));
    const title = screen.getByRole("textbox", { name: "Phrase title" });
    await user.clear(title);
    await user.type(title, "Ready check");
    await user.click(screen.getByRole("button", { name: "Save phrase" }));
    expect(api.updatePhrase).toHaveBeenCalledWith({
      input: expect.objectContaining({ id: "plain", title: "Ready check" }),
    });
    await user.click(screen.getByRole("button", { name: "Duplicate Ready" }));
    expect(api.duplicatePhrase).toHaveBeenCalledWith({
      phraseId: "plain",
      newPhraseId: expect.any(String),
    });
    await user.click(
      screen.getByRole("button", { name: "Remove Ready from favorites" }),
    );
    expect(api.setFavorite).toHaveBeenCalledWith({
      phraseId: "plain",
      favorite: false,
    });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Move Ready to group" }),
      "group-2",
    );
    expect(api.movePhrase).toHaveBeenCalledWith({
      phraseId: "plain",
      targetGroupId: "group-2",
      targetIndex: 0,
    });
    await user.click(screen.getByRole("button", { name: "Delete Ready" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.deletePhrase).toHaveBeenCalledWith({ phraseId: "plain" });
  });

  it("reorders the synthetic favorites view without changing group order", async () => {
    const user = userEvent.setup();
    const favoriteSnapshot: LibrarySnapshot = {
      ...baseSnapshot,
      phrases: [
        baseSnapshot.phrases[0],
        { ...baseSnapshot.phrases[1], favorite: true, favoriteOrder: 1 },
      ],
    };
    const api = makeApi({
      getLibrary: vi.fn().mockResolvedValue(favoriteSnapshot),
    });
    renderManager(api);
    await screen.findByText("Ready");
    await user.click(screen.getByRole("checkbox", { name: "Favorites" }));
    await user.click(screen.getByRole("button", { name: "Move Invite up" }));
    expect(api.reorderFavorites).toHaveBeenCalledWith({
      gameId: "game-1",
      orderedIds: ["template", "plain"],
    });
    expect(api.reorderPhrases).not.toHaveBeenCalled();
  });

  it.each([760, 999, 1000, 1440])(
    "uses the inspector drawer boundary accessibly at %i CSS pixels",
    async (width) => {
      const user = userEvent.setup();
      const { container } = renderManager(makeApi(), width);
      const edit = await screen.findByRole("button", { name: "Edit Ready" });
      await user.click(edit);
      if (width < 1000) {
        expect(
          screen.getByRole("dialog", { name: "Phrase inspector" }),
        ).toBeTruthy();
        await user.keyboard("{Escape}");
        await waitFor(() => expect(document.activeElement).toBe(edit));
      } else {
        expect(
          screen.queryByRole("dialog", { name: "Phrase inspector" }),
        ).toBeNull();
        expect(
          screen.getByRole("region", { name: "Phrase inspector" }),
        ).toBeTruthy();
      }
      const results = await axe.run(container, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(
        results.violations.filter(({ impact }) =>
          ["serious", "critical"].includes(impact ?? ""),
        ),
      ).toEqual([]);
    },
  );

  it("translates representative navigation, accessibility labels, and dynamic deletion counts", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    renderManager(api, 1440, "zh-TW");
    await screen.findByRole("heading", { name: "常用語" });
    expect(screen.getByRole("button", { name: "新增遊戲" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "編輯 Ready" })).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "刪除遊戲 Guild Wars" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "刪除遊戲" });
    expect(dialog.textContent).toContain("2 個群組");
    expect(dialog.textContent).toContain("7 個常用語");
  });
});
