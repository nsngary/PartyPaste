import { describe, expect, it } from "vitest";
import type { ShortcutEvent } from "../../api/contracts";
import shortcutEventFixtures from "./shortcut-event-fixtures.json";
import { normalizeShortcut, shortcutValidationError } from "./shortcut-model";

const typedShortcutEvents: ShortcutEvent[] = shortcutEventFixtures.map(
  (event) => {
    if (
      (event.type === "copy_phrase" || event.type === "copy_phrase_failed") &&
      typeof event.phraseId === "string"
    ) {
      return { type: event.type, phraseId: event.phraseId };
    }
    if (
      event.type === "show_overlay" &&
      (typeof event.openTemplatePhraseId === "string" ||
        event.openTemplatePhraseId === null)
    ) {
      return {
        type: event.type,
        openTemplatePhraseId: event.openTemplatePhraseId,
      };
    }
    throw new Error("Invalid shared shortcut event fixture");
  },
);

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

  it("canonicalizes function and named keys case-insensitively", () => {
    expect(normalizeShortcut("shift + ctrl + f1")).toBe("Ctrl+Shift+F1");
    expect(normalizeShortcut("CTRL+SHIFT+F1")).toBe("Ctrl+Shift+F1");
    expect(normalizeShortcut("win + pageup")).toBe("Meta+PageUp");
    expect(shortcutValidationError("ctrl+f1", ["CTRL+F1"])).toBe("duplicate");
  });

  it("shares the camelCase native event contract", () => {
    expect(typedShortcutEvents).toEqual([
      { type: "copy_phrase", phraseId: "plain" },
      { type: "copy_phrase_failed", phraseId: "plain" },
      { type: "show_overlay", openTemplatePhraseId: "template" },
      { type: "show_overlay", openTemplatePhraseId: null },
    ]);
  });
});
