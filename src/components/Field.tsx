import { cloneElement, type ReactElement, type ReactNode, useId } from "react";

interface FieldControlProps {
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true";
  id?: string;
  required?: boolean;
}

export interface FieldProps {
  children: ReactElement<FieldControlProps>;
  description?: ReactNode;
  error?: ReactNode;
  label: ReactNode;
  required?: boolean;
}

export function Field({
  children,
  description,
  error,
  label,
  required,
}: FieldProps) {
  const generatedId = useId();
  const controlId = children.props.id ?? generatedId;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;
  const describedBy = [
    children.props["aria-describedby"],
    description ? descriptionId : undefined,
    error ? errorId : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`pp-field${error ? " pp-field--error" : ""}`}>
      <label className="pp-field__label" htmlFor={controlId}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {cloneElement(children, {
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : children.props["aria-invalid"],
        id: controlId,
        required: required || children.props.required,
      })}
      {description ? (
        <div className="pp-field__description" id={descriptionId}>
          {description}
        </div>
      ) : null}
      {error ? (
        <div className="pp-field__error" id={errorId}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
