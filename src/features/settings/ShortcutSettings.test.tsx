import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandError } from "../../api/commands";
import { AppProviders, createPartyPasteI18n } from "../../i18n";
import { ShortcutSettings } from "./ShortcutSettings";

afterEach(cleanup);

describe("ShortcutSettings", () => {
  it("saves a normalized overlay shortcut through the existing native API", async () => {
    const user = userEvent.setup();
    const api = {
      getShortcuts: vi.fn().mockResolvedValue({
        overlay: "Ctrl+Shift+Space",
        phrases: {},
      }),
      setOverlayShortcut: vi.fn().mockResolvedValue({
        overlay: "Ctrl+Alt+O",
        phrases: {},
      }),
    };
    render(
      <AppProviders i18n={createPartyPasteI18n("en")}>
        <ShortcutSettings api={api} />
      </AppProviders>,
    );

    const input = await screen.findByLabelText("Show or hide overlay");
    await user.clear(input);
    await user.type(input, "alt + control + o");
    await user.click(screen.getByRole("button", { name: "Save shortcut" }));

    expect(api.setOverlayShortcut).toHaveBeenCalledWith("Ctrl+Alt+O");
    expect((input as HTMLInputElement).value).toBe("Ctrl+Alt+O");
  });

  it("retains and restores the previous working shortcut after a native conflict", async () => {
    const user = userEvent.setup();
    const api = {
      getShortcuts: vi.fn().mockResolvedValue({
        overlay: "Ctrl+Shift+Space",
        phrases: { phrase: "Ctrl+Alt+O" },
      }),
      setOverlayShortcut: vi.fn().mockRejectedValue(
        new CommandError({
          code: "shortcut_conflict",
          messageKey: "errors.shortcutConflict",
          details: { field: "shortcut" },
        }),
      ),
    };
    render(
      <AppProviders i18n={createPartyPasteI18n("en")}>
        <ShortcutSettings api={api} />
      </AppProviders>,
    );

    const input = await screen.findByLabelText("Show or hide overlay");
    await user.clear(input);
    await user.type(input, "Ctrl+Alt+P");
    await user.click(screen.getByRole("button", { name: "Save shortcut" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "That shortcut is already in use. The previous shortcut is still active.",
    );
    expect((input as HTMLInputElement).value).toBe("Ctrl+Shift+Space");
  });
});
