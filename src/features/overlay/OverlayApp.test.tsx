import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createPartyPasteI18n } from "../../i18n";
import type { LibrarySnapshot } from "../library/library-api";
import { OverlayApp, type OverlayAppProps } from "./OverlayApp";
import "../../styles/overlay.css";

afterEach(cleanup);

const snapshot: LibrarySnapshot = {
  games: [
    {
      id: "game-one",
      name: "Guild Wars",
      sortOrder: 0,
      overlayDisplayMode: "title",
    },
    {
      id: "game-two",
      name: "Monster Hunter",
      sortOrder: 1,
      overlayDisplayMode: "full",
    },
  ],
  groups: [
    {
      id: "group-one",
      gameId: "game-one",
      name: "Raids",
      collapsed: false,
      sortOrder: 0,
    },
    {
      id: "group-two",
      gameId: "game-one",
      name: "Trading",
      collapsed: true,
      sortOrder: 1,
    },
    {
      id: "group-three",
      gameId: "game-two",
      name: "Hunts",
      collapsed: false,
      sortOrder: 0,
    },
  ],
  phrases: [
    {
      id: "plain",
      groupId: "group-one",
      title: "Ready check",
      bodyTemplate: "Everyone ready?",
      favorite: true,
      favoriteOrder: 0,
      hotkey: null,
      sortOrder: 0,
    },
    {
      id: "trade",
      groupId: "group-two",
      title: "Selling materials",
      bodyTemplate: "Selling all spare materials.",
      favorite: false,
      favoriteOrder: null,
      hotkey: null,
      sortOrder: 0,
    },
    {
      id: "hunt",
      groupId: "group-three",
      title: "Join the hunt",
      bodyTemplate: "Join my hunt.",
      favorite: false,
      favoriteOrder: null,
      hotkey: null,
      sortOrder: 0,
    },
  ],
  variableDefinitions: [],
  variablePresets: [],
  phraseVariableRefs: [],
  settings: [],
};

function makeProps(overrides: Partial<OverlayAppProps> = {}): OverlayAppProps {
  return {
    libraryApi: {
      getLibrary: vi.fn().mockResolvedValue(snapshot),
      setOverlayDisplayMode: vi.fn().mockResolvedValue({
        value: { ...snapshot.games[0], overlayDisplayMode: "full" },
      }),
      updateGroup: vi.fn(),
    },
    copyApi: {
      copyPhrase: vi.fn(),
      getRecentCopies: vi.fn().mockResolvedValue([]),
    },
    subscribeToShortcutEvents: vi.fn().mockResolvedValue(() => undefined),
    ...overrides,
  };
}

function renderOverlay(props = makeProps()) {
  return render(
    <AppProviders i18n={createPartyPasteI18n("en")}>
      <OverlayApp {...props} />
    </AppProviders>,
  );
}

describe("gameplay overlay", () => {
  it("renders the saved per-game mode and persists a mode change", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    renderOverlay(props);

    expect(
      await screen.findByRole("button", { name: "Ready check" }),
    ).toBeTruthy();
    expect(screen.queryByText("Everyone ready?")).toBeNull();

    await user.click(screen.getByRole("radio", { name: "Full sentence" }));

    expect(screen.getByText("Everyone ready?")).toBeTruthy();
    await waitFor(() => {
      expect(props.libraryApi.setOverlayDisplayMode).toHaveBeenCalledWith({
        gameId: "game-one",
        displayMode: "full",
      });
    });
  });

  it("switches games, persists collapsed groups, and never duplicates favorites", async () => {
    const user = userEvent.setup();
    const updateGroup = vi.fn().mockResolvedValue({});
    const props = makeProps({
      libraryApi: {
        ...makeProps().libraryApi,
        updateGroup,
      },
    });
    renderOverlay(props);

    expect(await screen.findByText("Favorites")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Ready check" })).toHaveLength(
      1,
    );
    expect(
      screen.queryByRole("button", { name: "Selling materials" }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Trading" }));
    expect(
      screen.getByRole("button", { name: "Selling materials" }),
    ).toBeTruthy();
    expect(updateGroup).toHaveBeenCalledWith({
      input: { id: "group-two", name: "Trading", collapsed: false },
    });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Games" }),
      "game-two",
    );
    expect(screen.getByRole("button", { name: "Join the hunt" })).toBeTruthy();
    expect(screen.getByText("Join my hunt.")).toBeTruthy();
    expect(screen.queryByText("Ready check")).toBeNull();
  });

  it("copies a plain phrase, exposes recent copies, and retries a persistent failure", async () => {
    const user = userEvent.setup();
    const copyPhrase = vi
      .fn()
      .mockResolvedValueOnce({
        phraseId: "plain",
        title: "Ready check",
        resolvedAt: 1,
        resolvedText: "Everyone ready?",
      })
      .mockRejectedValueOnce(new Error("clipboard busy"))
      .mockResolvedValueOnce({
        phraseId: "plain",
        title: "Ready check",
        resolvedAt: 2,
        resolvedText: "Everyone ready?",
      });
    const props = makeProps({
      copyApi: {
        copyPhrase,
        getRecentCopies: vi.fn().mockResolvedValue([]),
      },
    });
    renderOverlay(props);

    await user.click(
      await screen.findByRole("button", { name: "Ready check" }),
    );
    expect((await screen.findByRole("status")).textContent).toContain("Copied");
    expect(copyPhrase).toHaveBeenLastCalledWith({
      phraseId: "plain",
      variables: {},
    });
    await user.click(screen.getByRole("button", { name: "Recent copies" }));
    expect(screen.getByText("Everyone ready?")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Ready check" }));
    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("Clipboard is unavailable");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(copyPhrase).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens the exact template requested by a shortcut and discards values on Escape", async () => {
    const user = userEvent.setup();
    let shortcutHandler:
      | ((event: {
          type: "show_overlay";
          openTemplatePhraseId: string | null;
        }) => void)
      | undefined;
    const templateSnapshot: LibrarySnapshot = {
      ...snapshot,
      phrases: [
        {
          ...snapshot.phrases[0],
          id: "template",
          title: "Raid invite",
          bodyTemplate: "Need {count} players at {time}",
        },
      ],
      variableDefinitions: [
        {
          id: "count-def",
          gameId: "game-one",
          name: "count",
          normalizedName: "count",
          sortOrder: 0,
        },
        {
          id: "time-def",
          gameId: "game-one",
          name: "time",
          normalizedName: "time",
          sortOrder: 1,
        },
      ],
      variablePresets: [
        {
          id: "count-two",
          variableDefinitionId: "count-def",
          value: "2",
          sortOrder: 0,
        },
      ],
    };
    const props = makeProps({
      libraryApi: {
        ...makeProps().libraryApi,
        getLibrary: vi.fn().mockResolvedValue(templateSnapshot),
      },
      subscribeToShortcutEvents: vi.fn(async (handler) => {
        shortcutHandler = handler;
        return () => undefined;
      }),
    });
    renderOverlay(props);
    await screen.findByRole("button", { name: "Raid invite" });

    shortcutHandler?.({
      type: "show_overlay",
      openTemplatePhraseId: "template",
    });
    const form = await screen.findByRole("group", { name: "Raid invite" });
    expect(form.contains(document.activeElement)).toBe(true);
    await user.type(screen.getByRole("textbox", { name: "count" }), "9");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Raid invite" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Raid invite" }));
    expect(
      (screen.getByRole("textbox", { name: "count" }) as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it.each([240, 300, 420])(
    "keeps compact controls accessible at %i CSS pixels",
    async (width) => {
      const { container } = renderOverlay();
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
      });
      window.dispatchEvent(new Event("resize"));
      await screen.findByRole("button", { name: "Ready check" });

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
});
