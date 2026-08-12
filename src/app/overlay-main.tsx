import { createRoot } from "react-dom/client";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Overlay root element is missing.");
}

createRoot(root).render(
  <main>
    <h1>PartyPaste Overlay</h1>
  </main>,
);
