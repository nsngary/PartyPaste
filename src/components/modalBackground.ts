interface ElementState {
  ariaHidden: string | null;
  hadOwnInert: boolean;
  inert: boolean | undefined;
  inertAttribute: string | null;
  supportsInert: boolean;
}

const modalStack: HTMLElement[] = [];
const originalStates = new Map<HTMLElement, ElementState>();

function captureState(element: HTMLElement): ElementState {
  return {
    ariaHidden: element.getAttribute("aria-hidden"),
    hadOwnInert: Object.hasOwn(element, "inert"),
    inert: element.inert,
    inertAttribute: element.getAttribute("inert"),
    supportsInert: "inert" in element,
  };
}

function remember(element: HTMLElement) {
  if (!originalStates.has(element)) {
    originalStates.set(element, captureState(element));
  }
}

function hideFromInteraction(element: HTMLElement) {
  element.inert = true;
  element.setAttribute("inert", "");
  element.setAttribute("aria-hidden", "true");
}

function restore(element: HTMLElement) {
  const state = originalStates.get(element);
  if (!state) return;

  if (state.supportsInert || state.hadOwnInert) {
    element.inert = state.inert ?? false;
  } else {
    Reflect.deleteProperty(element, "inert");
  }

  if (state.inertAttribute === null) element.removeAttribute("inert");
  else element.setAttribute("inert", state.inertAttribute);

  if (state.ariaHidden === null) element.removeAttribute("aria-hidden");
  else element.setAttribute("aria-hidden", state.ariaHidden);
}

function updateBackground() {
  const activePortal = modalStack.at(-1);
  for (const child of document.body.children) {
    if (!(child instanceof HTMLElement)) continue;
    remember(child);
    if (child === activePortal) restore(child);
    else hideFromInteraction(child);
  }
}

export function registerModalPortal(portal: HTMLElement): () => void {
  modalStack.push(portal);
  updateBackground();

  return () => {
    const index = modalStack.lastIndexOf(portal);
    if (index !== -1) modalStack.splice(index, 1);

    if (modalStack.length > 0) {
      updateBackground();
      return;
    }

    for (const [element] of originalStates) restore(element);
    originalStates.clear();
  };
}

export function isTopModalPortal(portal: HTMLElement): boolean {
  return modalStack.at(-1) === portal;
}
