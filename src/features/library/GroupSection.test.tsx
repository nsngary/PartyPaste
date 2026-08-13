import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createPartyPasteI18n } from "../../i18n";
import { GroupSection } from "./GroupSection";

afterEach(cleanup);

describe("group ordering alternatives", () => {
  it("keeps explicit keyboard move controls and group menus alongside drag handles", async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    const onMove = vi.fn();
    const onMoveGroup = vi.fn();
    const group = {
      id: "g1",
      gameId: "game",
      name: "Raids",
      collapsed: false,
      sortOrder: 0,
    } as const;
    const phrase = {
      id: "p1",
      groupId: "g1",
      title: "Ready",
      bodyTemplate: "Ready",
      favorite: false,
      favoriteOrder: null,
      hotkey: null,
      sortOrder: 0,
    } as const;
    const second = { ...phrase, id: "p2", title: "Go", sortOrder: 1 };
    render(
      <AppProviders i18n={createPartyPasteI18n("en")}>
        <GroupSection
          allGroups={[
            group,
            { ...group, id: "g2", name: "Trade", sortOrder: 1 },
          ]}
          group={group}
          phrases={[phrase, second]}
          onCreatePhrase={vi.fn()}
          onDeleteGroup={vi.fn()}
          onDeletePhrase={vi.fn()}
          onDuplicatePhrase={vi.fn()}
          onEditGroup={vi.fn()}
          onEditPhrase={vi.fn()}
          onMovePhrase={onMove}
          onMoveGroup={onMoveGroup}
          onReorderPhrases={onReorder}
          onToggleFavorite={vi.fn()}
        />
      </AppProviders>,
    );
    expect(
      screen
        .getByRole("button", { name: "Drag Ready" })
        .getAttribute("aria-describedby"),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Move Ready down" }));
    expect(onReorder).toHaveBeenCalledWith(["p2", "p1"]);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Move Ready to group" }),
      "g2",
    );
    expect(onMove).toHaveBeenCalledWith("p1", "g2", 0);
    await user.click(
      screen.getByRole("button", { name: "Move group Raids down" }),
    );
    expect(onMoveGroup).toHaveBeenCalledWith(1);
  });
});
