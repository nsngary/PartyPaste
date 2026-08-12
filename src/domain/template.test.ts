import { describe, expect, it } from "vitest";
import { parseTemplate, planTemplateRename, resolveTemplate } from "./template";
import fixtures from "./template.fixtures.json";

function definedValues(values: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

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
  for (const fixture of fixtures.resolution) {
    it(fixture.name, () => {
      const parsed = parseTemplate(fixture.source);

      expect(
        resolveTemplate(parsed.tokens, definedValues(fixture.values)),
      ).toEqual(
        "value" in fixture
          ? { ok: true, value: fixture.value }
          : { ok: false, error: fixture.issues },
      );
    });
  }
});

describe("shared variable lifecycle projections", () => {
  it("plans the shared rename transformation and impact counts", () => {
    const fixture = fixtures.rename;

    expect(
      planTemplateRename(
        fixture.phrases.map((phrase) => phrase.source),
        fixture.oldName,
        fixture.newName,
        fixture.existingNames,
      ),
    ).toEqual({
      ok: true,
      value: {
        sources: fixture.phrases.map((phrase) => phrase.renamedSource),
        renamedTokenCounts: fixture.phrases.map(
          (phrase) => phrase.renamedTokenCount,
        ),
        affectedPhraseCount: fixture.affectedPhraseCount,
        affectedTokenCount: fixture.affectedTokenCount,
      },
    });
  });

  it("rejects the shared conflicting rename without producing transformations", () => {
    const fixture = fixtures.atomicRename;

    expect(
      planTemplateRename(
        fixtures.rename.phrases.map((phrase) => phrase.source),
        fixture.oldName,
        fixture.newName,
        fixture.existingNames,
      ),
    ).toEqual({ ok: false, error: fixture.expectedError });
  });

  it("resolves deleted definitions through the shared free-text fallback", () => {
    const fixture = fixtures.deleteFallback;

    expect(fixture.phrases.length).toBe(fixture.affectedPhraseCount);
    expect(Object.keys(fixture.freeTextValues)).toContain(fixture.name);

    expect(
      fixture.phrases.map((phrase) => {
        const parsed = parseTemplate(phrase.source);
        return resolveTemplate(
          parsed.tokens,
          definedValues(fixture.freeTextValues),
        );
      }),
    ).toEqual(
      fixture.phrases.map((phrase) => ({ ok: true, value: phrase.resolved })),
    );
  });
});
