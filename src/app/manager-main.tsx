import { createRoot } from "react-dom/client";
import { createLibraryApi } from "../features/library/library-api";
import { ManagerApp } from "../features/library/ManagerApp";
import "../styles/controls.css";
import "../styles/manager.css";
import { PartyPasteProviders } from "./providers";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Manager root element is missing.");
}

createRoot(root).render(
  <PartyPasteProviders>
    <ManagerApp libraryApi={createLibraryApi()} />
  </PartyPasteProviders>,
);
