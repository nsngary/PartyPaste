export interface TextToken {
  type: "text";
  value: string;
}

export interface VariableToken {
  type: "variable";
  name: string;
}

export type TemplateToken = TextToken | VariableToken;

export type TemplateIssueCode =
  | "unbalanced_open_brace"
  | "unbalanced_close_brace"
  | "empty_name"
  | "nested_brace"
  | "control_character"
  | "missing_value"
  | "empty_value";

export interface TemplateIssue {
  code: TemplateIssueCode;
  offset: number;
  name?: string;
}

export interface TemplateParseResult {
  tokens: TemplateToken[];
  issues: TemplateIssue[];
}

export type Result<TValue, TError> =
  | { ok: true; value: TValue }
  | { ok: false; error: TError };

function isControlCharacter(value: string): boolean {
  const codePoint = value.codePointAt(0);
  return (
    codePoint !== undefined &&
    (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
  );
}

export function parseTemplate(source: string): TemplateParseResult {
  const characters = Array.from(source);
  const tokens: TemplateToken[] = [];
  const issues: TemplateIssue[] = [];
  let text = "";

  const flushText = () => {
    if (text.length > 0) {
      tokens.push({ type: "text", value: text });
      text = "";
    }
  };

  let index = 0;
  while (index < characters.length) {
    const character = characters[index];
    const next = characters[index + 1];

    if (character === "{" && next === "{") {
      text += "{";
      index += 2;
      continue;
    }
    if (character === "}" && next === "}") {
      text += "}";
      index += 2;
      continue;
    }
    if (character === "}") {
      issues.push({ code: "unbalanced_close_brace", offset: index });
      index += 1;
      continue;
    }
    if (character !== "{") {
      text += character;
      index += 1;
      continue;
    }

    flushText();
    const openingOffset = index;
    let cursor = index + 1;
    let depth = 1;
    let nested = false;
    let name = "";

    while (cursor < characters.length && depth > 0) {
      const variableCharacter = characters[cursor];
      if (variableCharacter === "{") {
        nested = true;
        depth += 1;
      } else if (variableCharacter === "}") {
        depth -= 1;
      } else if (depth === 1) {
        name += variableCharacter;
      }
      cursor += 1;
    }

    if (depth > 0) {
      issues.push({ code: "unbalanced_open_brace", offset: openingOffset });
      index = cursor;
      continue;
    }
    if (nested) {
      issues.push({ code: "nested_brace", offset: openingOffset });
      index = cursor;
      continue;
    }
    if (name.length === 0) {
      issues.push({ code: "empty_name", offset: openingOffset });
      index = cursor;
      continue;
    }
    if (Array.from(name).some(isControlCharacter)) {
      issues.push({ code: "control_character", offset: openingOffset });
      index = cursor;
      continue;
    }

    tokens.push({ type: "variable", name });
    index = cursor;
  }

  flushText();
  return { tokens, issues };
}

export function resolveTemplate(
  tokens: readonly TemplateToken[],
  values: Readonly<Record<string, string>>,
): Result<string, TemplateIssue[]> {
  const issues: TemplateIssue[] = [];
  const reportedNames = new Set<string>();
  let value = "";

  for (const [offset, token] of tokens.entries()) {
    if (token.type === "text") {
      value += token.value;
      continue;
    }

    const replacement = values[token.name];
    if (replacement === undefined) {
      if (!reportedNames.has(token.name)) {
        issues.push({ code: "missing_value", name: token.name, offset });
        reportedNames.add(token.name);
      }
      continue;
    }
    if (replacement.trim().length === 0) {
      if (!reportedNames.has(token.name)) {
        issues.push({ code: "empty_value", name: token.name, offset });
        reportedNames.add(token.name);
      }
      continue;
    }
    value += replacement;
  }

  return issues.length === 0
    ? { ok: true, value }
    : { ok: false, error: issues };
}

export interface TemplateRenamePlan {
  sources: string[];
  renamedTokenCounts: number[];
  affectedPhraseCount: number;
  affectedTokenCount: number;
}

export type TemplateRenameError = "name_conflict" | "invalid_template";

export function planTemplateRename(
  sources: readonly string[],
  oldName: string,
  newName: string,
  existingNames: readonly string[],
): Result<TemplateRenamePlan, TemplateRenameError> {
  if (existingNames.some((name) => name !== oldName && name === newName)) {
    return { ok: false, error: "name_conflict" };
  }

  const renamedSources: string[] = [];
  const renamedTokenCounts: number[] = [];
  let affectedPhraseCount = 0;
  let affectedTokenCount = 0;

  for (const source of sources) {
    const parsed = parseTemplate(source);
    if (parsed.issues.length > 0) {
      return { ok: false, error: "invalid_template" };
    }

    let phraseTokenCount = 0;
    const tokens = parsed.tokens.map((token): TemplateToken => {
      if (token.type === "variable" && token.name === oldName) {
        phraseTokenCount += 1;
        return { type: "variable", name: newName };
      }
      return token;
    });

    renamedSources.push(renderTemplate(tokens));
    renamedTokenCounts.push(phraseTokenCount);
    affectedTokenCount += phraseTokenCount;
    if (phraseTokenCount > 0) {
      affectedPhraseCount += 1;
    }
  }

  return {
    ok: true,
    value: {
      sources: renamedSources,
      renamedTokenCounts,
      affectedPhraseCount,
      affectedTokenCount,
    },
  };
}

function renderTemplate(tokens: readonly TemplateToken[]): string {
  let source = "";
  for (const token of tokens) {
    if (token.type === "variable") {
      source += `{${token.name}}`;
      continue;
    }
    for (const character of token.value) {
      source += character === "{" ? "{{" : character === "}" ? "}}" : character;
    }
  }
  return source;
}
