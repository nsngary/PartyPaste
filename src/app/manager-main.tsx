import { listen } from "@tauri-apps/api/event";
import { createRoot } from "react-dom/client";
import { createLibraryApi } from "../features/library/library-api";
import { ManagerApp } from "../features/library/ManagerApp";
import "../styles/controls.css";
import "../styles/manager.css";
import { PartyPasteProviders } from "./providers";

const root = document.getElementById("root");

if (!root) {
  throw new Error("PARTYPASTE_MANAGER_ROOT_MISSING");
}

createRoot(root).render(
  <PartyPasteProviders>
    <ManagerApp
      libraryApi={createLibraryApi()}
      subscribeToOpenUpdateSettings={async (handler) => {
        const unlisten = await listen("open-update-settings", handler);
        return unlisten;
      }}
    />
  </PartyPasteProviders>,
);
