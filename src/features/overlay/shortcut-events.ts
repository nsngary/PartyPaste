import { listen } from "@tauri-apps/api/event";
import type { ShortcutEventPayload } from "./OverlayApp";

export function subscribeToShortcutEvents(
  handler: (event: ShortcutEventPayload) => void,
) {
  return listen<ShortcutEventPayload>("shortcut-action", ({ payload }) => {
    handler(payload);
  });
}
