import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
      setGroupCollapsed: vi.fn(),
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
    const setGroupCollapsed = vi.fn().mockResolvedValue({});
    const props = makeProps({
      libraryApi: {
        ...makeProps().libraryApi,
        setGroupCollapsed,
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
    expect(setGroupCollapsed).toHaveBeenCalledWith({
      groupId: "group-two",
      collapsed: false,
    });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Games" }),
      "game-two",
    );
    expect(
      screen.getByRole("button", { name: "Join the hunt Join my hunt." }),
    ).toBeTruthy();
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
        getRecentCopies: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValue([
            {
              phraseId: "plain",
              title: "Ready check",
              resolvedAt: 1,
              resolvedText: "Everyone ready?",
            },
          ]),
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

  it("retries the exact failed template request and the current later failure", async () => {
    const user = userEvent.setup();
    const requests: Array<{
      phraseId: string;
      variables: Record<string, string>;
    }> = [];
    const copyPhrase = vi.fn(async (request) => {
      requests.push(request);
      throw new Error("clipboard busy");
    });
    const templateSnapshot = {
      ...snapshot,
      phrases: [
        {
          ...snapshot.phrases[0],
          id: "template",
          title: "Invite",
          bodyTemplate: "Need {count}",
        },
        {
          ...snapshot.phrases[1],
          id: "other",
          groupId: "group-one",
          title: "Other",
          bodyTemplate: "Other",
        },
      ],
    };
    renderOverlay(
      makeProps({
        libraryApi: {
          ...makeProps().libraryApi,
          getLibrary: vi.fn().mockResolvedValue(templateSnapshot),
        },
        copyApi: { copyPhrase, getRecentCopies: vi.fn().mockResolvedValue([]) },
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Invite" }));
    await user.type(screen.getByRole("textbox", { name: "count" }), "7");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toEqual({
      phraseId: "template",
      variables: { count: "7" },
    });
    await user.click(screen.getByRole("button", { name: "Other" }));
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(requests.at(-1)).toEqual({ phraseId: "other", variables: {} });
    expect(requests[0]).toEqual({
      phraseId: "template",
      variables: { count: "7" },
    });
  });

  it("does not let an older overlapping failure replace the current retry target", async () => {
    const user = userEvent.setup();
    const rejections: Array<(error: Error) => void> = [];
    const copyPhrase = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejections.push(reject);
        }),
    );
    const overlapSnapshot: LibrarySnapshot = {
      ...snapshot,
      phrases: [
        {
          ...snapshot.phrases[0],
          id: "first",
          title: "First",
          bodyTemplate: "First",
        },
        {
          ...snapshot.phrases[1],
          id: "second",
          groupId: "group-one",
          title: "Second",
          bodyTemplate: "Second",
        },
      ],
    };
    renderOverlay(
      makeProps({
        libraryApi: {
          ...makeProps().libraryApi,
          getLibrary: vi.fn().mockResolvedValue(overlapSnapshot),
        },
        copyApi: { copyPhrase, getRecentCopies: vi.fn().mockResolvedValue([]) },
      }),
    );
    await user.click(await screen.findByRole("button", { name: "First" }));
    await user.click(screen.getByRole("button", { name: "Second" }));
    rejections[1](new Error("second failed"));
    await screen.findByRole("alert");
    rejections[0](new Error("first failed later"));
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(copyPhrase).toHaveBeenLastCalledWith({
      phraseId: "second",
      variables: {},
    });
  });

  it("caps recent copies to the native thirty-item result after success", async () => {
    const user = userEvent.setup();
    const nativeRecent = Array.from({ length: 30 }, (_, index) => ({
      phraseId: `p-${index}`,
      title: `Phrase ${index}`,
      resolvedAt: index,
      resolvedText: `Text ${index}`,
    }));
    const getRecentCopies = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue(nativeRecent);
    renderOverlay(
      makeProps({
        copyApi: {
          copyPhrase: vi.fn().mockResolvedValue({
            phraseId: "plain",
            title: "Ready check",
            resolvedAt: 31,
            resolvedText: "Everyone ready?",
          }),
          getRecentCopies,
        },
      }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Ready check" }),
    );
    await waitFor(() => expect(getRecentCopies).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Recent copies" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(30);
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

  it("queues an early shortcut and opens a collapsed nonfavorite template after load", async () => {
    let resolveLibrary: (value: LibrarySnapshot) => void = () => undefined;
    const library = new Promise<LibrarySnapshot>((resolve) => {
      resolveLibrary = resolve;
    });
    let shortcutHandler:
      | ((event: {
          type: "show_overlay";
          openTemplatePhraseId: string | null;
        }) => void)
      | undefined;
    const earlySnapshot: LibrarySnapshot = {
      ...snapshot,
      phrases: [
        {
          ...snapshot.phrases[1],
          id: "hidden-template",
          favorite: false,
          title: "Hidden form",
          bodyTemplate: "Need {count}",
        },
      ],
    };
    renderOverlay(
      makeProps({
        libraryApi: {
          ...makeProps().libraryApi,
          getLibrary: vi.fn().mockReturnValue(library),
        },
        subscribeToShortcutEvents: vi.fn(async (handler) => {
          shortcutHandler = handler;
          return () => undefined;
        }),
      }),
    );
    await waitFor(() => expect(shortcutHandler).toBeTruthy());
    shortcutHandler?.({
      type: "show_overlay",
      openTemplatePhraseId: "hidden-template",
    });
    resolveLibrary(earlySnapshot);

    const form = await screen.findByRole("group", { name: "Hidden form" });
    expect(form.contains(document.activeElement)).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Trading" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("turns a sanitized native shortcut-copy failure into a retryable request", async () => {
    const user = userEvent.setup();
    let shortcutHandler:
      | ((event: { type: "copy_phrase_failed"; phraseId: string }) => void)
      | undefined;
    const copyPhrase = vi.fn().mockResolvedValue({
      phraseId: "plain",
      title: "Ready check",
      resolvedAt: 4,
      resolvedText: "Everyone ready?",
    });
    renderOverlay(
      makeProps({
        copyApi: {
          copyPhrase,
          getRecentCopies: vi.fn().mockResolvedValue([]),
        },
        subscribeToShortcutEvents: vi.fn(async (handler) => {
          shortcutHandler = handler;
          return () => undefined;
        }),
      }),
    );
    await waitFor(() => expect(shortcutHandler).toBeTruthy());
    shortcutHandler?.({ type: "copy_phrase_failed", phraseId: "plain" });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Clipboard is unavailable",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(copyPhrase).toHaveBeenCalledWith({
      phraseId: "plain",
      variables: {},
    });
  });

  it("maps normalized variable identities to presets and restores row focus on close", async () => {
    const user = userEvent.setup();
    const normalizedSnapshot: LibrarySnapshot = {
      ...snapshot,
      phrases: [
        {
          ...snapshot.phrases[0],
          id: "normalized",
          title: "Normalized",
          bodyTemplate: "Need {ＣＯＵＮＴ}",
        },
      ],
      variableDefinitions: [
        {
          id: "definition",
          gameId: "game-one",
          name: "Count",
          normalizedName: "count",
          sortOrder: 0,
        },
      ],
      variablePresets: [
        {
          id: "preset",
          variableDefinitionId: "definition",
          value: "4",
          sortOrder: 0,
        },
      ],
      phraseVariableRefs: [
        {
          phraseId: "normalized",
          variableDefinitionId: "definition",
          tokenOrder: 0,
        },
      ],
    };
    renderOverlay(
      makeProps({
        libraryApi: {
          ...makeProps().libraryApi,
          getLibrary: vi.fn().mockResolvedValue(normalizedSnapshot),
        },
      }),
    );
    const trigger = await screen.findByRole("button", { name: "Normalized" });
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "4" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("uses title-only and full-sentence accessible names", async () => {
    const user = userEvent.setup();
    renderOverlay();
    await screen.findByRole("button", { name: "Ready check" });
    expect(
      screen.queryByRole("button", { name: "Ready check Everyone ready?" }),
    ).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Full sentence" }));
    expect(
      screen.getByRole("button", { name: "Ready check Everyone ready?" }),
    ).toBeTruthy();
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

      const overlayCss = readFileSync(
        resolve("src/styles/overlay.css"),
        "utf8",
      );
      expect(overlayCss).toContain("min-width: 240px");
      expect(overlayCss).toMatch(/min-height:\s*32px/);
      expect(container.querySelector("main")?.scrollWidth).toBeLessThanOrEqual(
        container.querySelector("main")?.clientWidth || width,
      );

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
