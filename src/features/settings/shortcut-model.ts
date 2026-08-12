const modifierAliases: Record<string, string> = {
  alt: "Alt",
  control: "Ctrl",
  ctrl: "Ctrl",
  meta: "Meta",
  option: "Alt",
  shift: "Shift",
  super: "Meta",
  win: "Meta",
};

const modifierOrder = ["Ctrl", "Alt", "Shift", "Meta"];
const keyAliases: Record<string, string> = {
  enter: "Enter",
  esc: "Escape",
  escape: "Escape",
  space: "Space",
  tab: "Tab",
};

export type ShortcutValidationError = "modifier_required" | "duplicate";

export function normalizeShortcut(shortcut: string): string {
  const parts = shortcut
    .trim()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const modifiers = new Set<string>();
  const keys: string[] = [];

  for (const part of parts) {
    const modifier = modifierAliases[part.toLowerCase()];
    if (modifier) {
      modifiers.add(modifier);
    } else {
      keys.push(
        keyAliases[part.toLowerCase()] ??
          (part.length === 1 ? part.toUpperCase() : part),
      );
    }
  }

  return [
    ...modifierOrder.filter((modifier) => modifiers.has(modifier)),
    ...keys,
  ].join("+");
}

export function shortcutValidationError(
  shortcut: string,
  configuredShortcuts: readonly string[],
): ShortcutValidationError | undefined {
  const normalized = normalizeShortcut(shortcut);
  const parts = normalized.split("+");
  if (!parts.some((part) => modifierOrder.includes(part))) {
    return "modifier_required";
  }
  return configuredShortcuts.some(
    (configured) => normalizeShortcut(configured) === normalized,
  )
    ? "duplicate"
    : undefined;
}
