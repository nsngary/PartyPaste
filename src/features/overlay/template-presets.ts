import { parseTemplate } from "../../domain/template";
import type { LibrarySnapshot, PhraseDto } from "../library/library-api";

function normalizeVariableName(name: string) {
  return name.normalize("NFKC").toLocaleLowerCase("en-US");
}

export function presetsForPhrase(
  library: LibrarySnapshot,
  phrase: PhraseDto,
): Record<string, string[]> {
  const definitions = new Map(
    library.variableDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  const definitionsByName = new Map(
    library.variableDefinitions.map((definition) => [
      normalizeVariableName(definition.normalizedName),
      definition,
    ]),
  );
  const references = new Map(
    library.phraseVariableRefs
      .filter((reference) => reference.phraseId === phrase.id)
      .map((reference) => [
        reference.tokenOrder,
        reference.variableDefinitionId,
      ]),
  );
  const presetsByDefinition = new Map<string, string[]>();
  for (const preset of [...library.variablePresets].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  )) {
    const values = presetsByDefinition.get(preset.variableDefinitionId) ?? [];
    values.push(preset.value);
    presetsByDefinition.set(preset.variableDefinitionId, values);
  }

  const result: Record<string, string[]> = {};
  let variableOrder = 0;
  for (const token of parseTemplate(phrase.bodyTemplate).tokens) {
    if (token.type !== "variable") continue;
    const referencedDefinition = definitions.get(
      references.get(variableOrder) ?? "",
    );
    const definition =
      referencedDefinition ??
      definitionsByName.get(normalizeVariableName(token.name));
    if (definition) {
      result[token.name] = presetsByDefinition.get(definition.id) ?? [];
    }
    variableOrder += 1;
  }
  return result;
}
