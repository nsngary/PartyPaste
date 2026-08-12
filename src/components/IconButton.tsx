import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface IconButtonProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "aria-label" | "children"
  > {
  icon: ReactNode;
  label: string;
  variant?: "plain" | "outlined";
}

export function IconButton({
  className = "",
  icon,
  label,
  type = "button",
  variant = "plain",
  ...props
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={`pp-icon-button pp-icon-button--${variant} ${className}`.trim()}
      type={type}
      {...props}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
