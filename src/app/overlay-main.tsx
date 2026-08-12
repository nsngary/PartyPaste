import { createRoot } from "react-dom/client";
import { createLibraryApi } from "../features/library/library-api";
import { createCopyApi } from "../features/overlay/copy-api";
import { OverlayApp } from "../features/overlay/OverlayApp";
import { subscribeToShortcutEvents } from "../features/overlay/shortcut-events";
import { AppProviders } from "../i18n";
import "../styles/controls.css";
import "../styles/overlay.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Overlay root element is missing.");
}

createRoot(root).render(
  <AppProviders>
    <OverlayApp
      copyApi={createCopyApi()}
      libraryApi={createLibraryApi()}
      subscribeToShortcutEvents={subscribeToShortcutEvents}
    />
  </AppProviders>,
);
