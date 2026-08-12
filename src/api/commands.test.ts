import { describe, expect, it } from "vitest";
import { CommandError, invokeCommand } from "./commands";

describe("invokeCommand", () => {
  it("converts a rejected native error payload into CommandError", async () => {
    const invoke = async () => {
      throw {
        code: "shortcut_conflict",
        messageKey: "errors.shortcutConflict",
      };
    };

    await expect(
      invokeCommand("save_shortcut", { shortcut: "Ctrl+Shift+P" }, invoke),
    ).rejects.toMatchObject({
      code: "shortcut_conflict",
      messageKey: "errors.shortcutConflict",
    });

    await expect(
      invokeCommand("save_shortcut", { shortcut: "Ctrl+Shift+P" }, invoke),
    ).rejects.toBeInstanceOf(CommandError);
  });

  it("collapses an arbitrary message key to the generic internal error", async () => {
    const phrase = "secret phrase owned by a user";
    const invoke = async () => {
      throw { code: "shortcut_conflict", messageKey: phrase };
    };

    const rejection = invokeCommand(
      "save_shortcut",
      { shortcut: "Ctrl+Shift+P" },
      invoke,
    );
    await expect(rejection).rejects.toMatchObject({
      code: "internal",
      messageKey: "errors.internal",
      message: "errors.internal",
    });
    const error = await rejection.catch((rejection: unknown) => rejection);
    expect(JSON.stringify(error)).not.toContain(phrase);
    expect(String(error)).not.toContain(phrase);
  });

  it("collapses arbitrary detail text to the generic internal error", async () => {
    const phrase = "secret phrase owned by a user";
    const invoke = async () => {
      throw {
        code: "shortcut_conflict",
        messageKey: "errors.shortcutConflict",
        details: { phrase },
      };
    };

    const rejection = invokeCommand(
      "save_shortcut",
      { shortcut: "Ctrl+Shift+P" },
      invoke,
    );
    await expect(rejection).rejects.toMatchObject({
      code: "internal",
      messageKey: "errors.internal",
      message: "errors.internal",
    });
    const error = await rejection.catch((rejection: unknown) => rejection);
    expect(JSON.stringify(error)).not.toContain(phrase);
    expect(String(error)).not.toContain(phrase);
  });
});
