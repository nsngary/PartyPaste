import { type ReactNode, type RefObject, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "./useModalFocus";

export interface DrawerProps {
  children: ReactNode;
  description?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  open: boolean;
  title: ReactNode;
}

export function Drawer({
  children,
  description,
  initialFocusRef,
  onClose,
  open,
  title,
}: DrawerProps) {
  const containerRef = useRef<HTMLElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useModalFocus({ containerRef, initialFocusRef, onClose, open, portalRef });

  if (!open) return null;

  return createPortal(
    <div className="pp-drawer-backdrop" ref={portalRef}>
      <aside
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="pp-drawer"
        ref={containerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="pp-drawer__header">
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </header>
        <div className="pp-drawer__body">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
