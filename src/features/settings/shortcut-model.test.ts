import { describe, expect, it } from "vitest";
import { normalizeShortcut, shortcutValidationError } from "./shortcut-model";

describe("shortcut model", () => {
  it("canonicalizes modifier aliases and rejects accelerators without a modifier", () => {
    expect(normalizeShortcut(" shift + control + p ")).toBe("Ctrl+Shift+P");
    expect(shortcutValidationError("P", [])).toBe("modifier_required");
  });

  it("detects configuration duplicates after canonical normalization", () => {
    expect(
      shortcutValidationError("ctrl + shift + p", ["Control+Shift+P"]),
    ).toBe("duplicate");
  });
});
