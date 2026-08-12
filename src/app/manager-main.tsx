import { createRoot } from "react-dom/client";
import "../styles/controls.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Manager root element is missing.");
}

createRoot(root).render(
  <main>
    <h1>PartyPaste Manager</h1>
  </main>,
);
