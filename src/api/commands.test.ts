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
});
