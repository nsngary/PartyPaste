import { listen } from "@tauri-apps/api/event";
import type { LibrarySnapshot } from "../library/library-api";

export function subscribeToLibraryChanges(
  handler: (snapshot: LibrarySnapshot) => void,
): Promise<() => void> {
  return listen<LibrarySnapshot>(
    "library-changed",
    ({ payload }) => {
      handler(payload);
    },
  );
}