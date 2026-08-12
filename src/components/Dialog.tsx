import { type ReactNode, type RefObject, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "./useModalFocus";

export interface DialogProps {
  children: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  open: boolean;
  title: ReactNode;
}

export function Dialog({
  children,
  description,
  footer,
  initialFocusRef,
  onClose,
  open,
  title,
}: DialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useModalFocus({ containerRef, initialFocusRef, onClose, open, portalRef });

  if (!open) return null;

  return createPortal(
    <div className="pp-modal-backdrop" ref={portalRef}>
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="pp-dialog"
        ref={containerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="pp-dialog__header">
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </header>
        <div className="pp-dialog__body">{children}</div>
        {footer ? (
          <footer className="pp-dialog__footer">{footer}</footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
