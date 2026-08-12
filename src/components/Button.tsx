import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
  loadingLabel?: string;
  leadingIcon?: ReactNode;
}

export function Button({
  children,
  className = "",
  disabled,
  leadingIcon,
  loading = false,
  loadingLabel = "Loading",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`pp-button pp-button--${variant} ${className}`.trim()}
      disabled={disabled || loading}
      type={type}
      {...props}
    >
      {leadingIcon ? (
        <span className="pp-button__icon" aria-hidden="true">
          {leadingIcon}
        </span>
      ) : null}
      {loading ? (
        <span className="pp-visually-hidden">{loadingLabel}</span>
      ) : (
        children
      )}
    </button>
  );
}
