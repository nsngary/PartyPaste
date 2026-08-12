import { describe, expect, it } from "vitest";
import {
  normalizeLibraryInput,
  validateGameName,
  validateGroupName,
  validatePhraseBody,
  validatePhraseTitle,
} from "./validation";

describe("library validation", () => {
  it.each([
    [validateGameName, 80],
    [validateGroupName, 80],
    [validatePhraseTitle, 120],
    [validatePhraseBody, 4000],
  ] as const)("accepts its exact Unicode scalar limit", (validate, limit) => {
    expect(validate("界".repeat(limit))).toEqual({
      ok: true,
      value: "界".repeat(limit),
    });
    expect(validate("界".repeat(limit + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("trims and NFKC-normalizes before validating", () => {
    expect(validateGameName("  Ｇａｍｅ  ")).toEqual({
      ok: true,
      value: "Game",
    });
    expect(validatePhraseTitle("  ")).toEqual({
      ok: false,
      reason: "required",
    });
  });

  it("preserves intentional phrase-body boundary whitespace", () => {
    expect(validatePhraseBody("  hello  ")).toEqual({
      ok: true,
      value: "  hello  ",
    });
  });

  it("counts Unicode scalar values instead of UTF-16 code units", () => {
    expect(validatePhraseTitle("🎮".repeat(120)).ok).toBe(true);
  });

  it("normalizes form input without pretending to implement Unicode case folding", () => {
    expect(normalizeLibraryInput("  ＳＴＲＡＳＳＥ  ")).toBe("STRASSE");
    expect(normalizeLibraryInput("Straße")).toBe("Straße");
    expect(normalizeLibraryInput("ı")).toBe("ı");
  });
});
