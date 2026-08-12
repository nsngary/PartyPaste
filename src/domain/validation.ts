export type ValidationFailure = "required" | "too_long";
export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; reason: ValidationFailure };

function validateText(
  value: string,
  maximumScalars: number,
  trim = true,
): ValidationResult {
  const normalized = (trim ? value.trim() : value).normalize("NFKC");
  if (normalized.trim().length === 0) {
    return { ok: false, reason: "required" };
  }
  if (Array.from(normalized).length > maximumScalars) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, value: normalized };
}

export const validateGameName = (value: string) => validateText(value, 80);
export const validateGroupName = (value: string) => validateText(value, 80);
export const validatePhraseTitle = (value: string) => validateText(value, 120);
export const validatePhraseBody = (value: string) =>
  validateText(value, 4000, false);

export function normalizeLibraryText(value: string): string {
  // Upper-then-lower expands compatibility folds such as German sharp-s in
  // JavaScript runtimes that do not expose Unicode's CaseFolding.txt directly.
  return value.trim().normalize("NFKC").toUpperCase().toLowerCase();
}
