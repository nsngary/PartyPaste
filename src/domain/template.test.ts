import { describe, expect, it } from "vitest";
import { parseTemplate, resolveTemplate } from "./template";
import fixtures from "./template.fixtures.json";

describe("parseTemplate shared fixtures", () => {
  for (const fixture of fixtures.valid) {
    it(`scans ${fixture.name}`, () => {
      expect(parseTemplate(fixture.source)).toEqual({
        tokens: fixture.tokens,
        issues: [],
      });
    });
  }

  for (const fixture of fixtures.invalid) {
    it(`rejects ${fixture.name}`, () => {
      const result = parseTemplate(fixture.source);

      expect(result.issues.map((issue) => issue.code)).toEqual(
        fixture.issueCodes,
      );
    });
  }
});

describe("resolveTemplate", () => {
  it("resolves repeated variables from a structured token stream", () => {
    const parsed = parseTemplate("隊伍有 {人數} 人，共 {人數} 位");

    expect(resolveTemplate(parsed.tokens, { 人數: "4" })).toEqual({
      ok: true,
      value: "隊伍有 4 人，共 4 位",
    });
  });

  it("accepts a free-text value for a variable absent from the library", () => {
    const parsed = parseTemplate("前往 {陌生欄位}");

    expect(resolveTemplate(parsed.tokens, { 陌生欄位: "北門" })).toEqual({
      ok: true,
      value: "前往 北門",
    });
  });

  it("reports every variable without a non-empty value", () => {
    const parsed = parseTemplate("{人數} / {時間} / {地點}");

    expect(resolveTemplate(parsed.tokens, { 人數: "4", 時間: "" })).toEqual({
      ok: false,
      error: [
        { code: "empty_value", name: "時間", offset: 2 },
        { code: "missing_value", name: "地點", offset: 4 },
      ],
    });
  });
});
