import { type RefObject, useEffect, useRef } from "react";
import { isTopModalPortal, registerModalPortal } from "./modalBackground";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface ModalFocusOptions {
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  open: boolean;
  portalRef: RefObject<HTMLElement | null>;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true",
  );
}

export function useModalFocus({
  containerRef,
  initialFocusRef,
  onClose,
  open,
  portalRef,
}: ModalFocusOptions) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const container = containerRef.current;
    const portal = portalRef.current;
    if (!container || !portal) return;
    const modal: HTMLElement = container;
    const modalPortal: HTMLElement = portal;
    const unregisterPortal = registerModalPortal(modalPortal);

    const initialTarget =
      initialFocusRef?.current ?? focusableElements(modal)[0] ?? modal;
    initialTarget.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (!isTopModalPortal(modalPortal)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const elements = focusableElements(modal);
      if (elements.length === 0) {
        event.preventDefault();
        modal.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !modal.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      unregisterPortal();
      previouslyFocused?.focus();
    };
  }, [containerRef, initialFocusRef, open, portalRef]);
}
