import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { parseTemplate, resolveTemplate } from "../../domain/template";

export interface TemplateFormProps {
  autoFocus?: boolean;
  bodyTemplate: string;
  onClose: () => void;
  onCopy: (values: Record<string, string>) => void;
  presets: Readonly<Record<string, readonly string[]>>;
  title: string;
}

export function TemplateForm({
  autoFocus = false,
  bodyTemplate,
  onClose,
  onCopy,
  presets,
  title,
}: TemplateFormProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const firstInput = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseTemplate(bodyTemplate), [bodyTemplate]);
  const variableNames = useMemo(
    () =>
      Array.from(
        new Set(
          parsed.tokens.flatMap((token) =>
            token.type === "variable" ? [token.name] : [],
          ),
        ),
      ),
    [parsed.tokens],
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const resolution = resolveTemplate(parsed.tokens, values);
  const malformed = parsed.issues.length > 0;

  useEffect(() => {
    if (autoFocus) firstInput.current?.focus();
  }, [autoFocus]);

  return (
    <form
      className="pp-template-form"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (resolution.ok) onCopy(values);
      }}
    >
      <fieldset aria-labelledby={titleId}>
        <legend className="pp-template-form__heading">
          <strong id={titleId}>{title}</strong>
          <button onClick={onClose} type="button">
            {t("common.close")}
          </button>
        </legend>
        {variableNames.map((name, index) => (
          <div className="pp-template-variable" key={name}>
            <label htmlFor={`${titleId}-${index}`}>{name}</label>
            {(presets[name] ?? []).length > 0 ? (
              <fieldset
                aria-label={t("overlay.commonValues")}
                className="pp-template-variable__presets"
              >
                {(presets[name] ?? []).map((preset) => (
                  <button
                    aria-pressed={values[name] === preset}
                    key={preset}
                    onClick={() =>
                      setValues((current) => ({ ...current, [name]: preset }))
                    }
                    type="button"
                  >
                    {preset}
                  </button>
                ))}
              </fieldset>
            ) : null}
            <input
              id={`${titleId}-${index}`}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [name]: event.target.value,
                }))
              }
              ref={index === 0 ? firstInput : undefined}
              value={values[name] ?? ""}
            />
          </div>
        ))}
        {malformed ? (
          <p className="pp-template-form__error" role="alert">
            {t("overlay.templateInvalid")}
          </p>
        ) : (
          <div className="pp-template-preview">
            <span>{t("overlay.preview")}</span>
            <output>{resolution.ok ? resolution.value : bodyTemplate}</output>
          </div>
        )}
        <Button disabled={malformed || !resolution.ok} type="submit">
          {t("common.copy")}
        </Button>
        {!malformed && !resolution.ok ? (
          <p className="pp-template-form__hint">
            {t("overlay.templateIncomplete")}
          </p>
        ) : null}
      </fieldset>
    </form>
  );
}
