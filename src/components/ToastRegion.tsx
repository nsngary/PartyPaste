import type { ReactNode } from "react";

export interface ToastMessage {
  action?: ReactNode;
  id: string;
  message: ReactNode;
  tone?: "success" | "error" | "neutral";
}

export interface ToastRegionProps {
  label: string;
  toasts: readonly ToastMessage[];
}

export function ToastRegion({ label, toasts }: ToastRegionProps) {
  return (
    <section aria-label={label} className="pp-toast-region">
      {toasts.map(({ action, id, message, tone = "neutral" }) => (
        <div
          className={`pp-toast pp-toast--${tone}`}
          key={id}
          role={tone === "error" ? "alert" : "status"}
        >
          <span>{message}</span>
          {action ? <span className="pp-toast__action">{action}</span> : null}
        </div>
      ))}
    </section>
  );
}
