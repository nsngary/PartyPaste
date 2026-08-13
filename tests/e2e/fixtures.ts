import type { Page } from "playwright/test";
import libraryFixture from "../fixtures/library-v1.json" with { type: "json" };

export async function installFakeBridge(page: Page) {
  await page.addInitScript((initialLibrary) => {
    const library = structuredClone(initialLibrary);
    const calls: Array<{ command: string; input: Record<string, unknown> }> =
      [];
    const recent: Array<Record<string, unknown>> = [];
    let alwaysOnTop = true;
    let overlayShortcut = "Ctrl+Shift+Space";
    let backupPreview: { path: string; previewToken: string } | undefined;
    let callbackId = 0;
    const callbacks = new Map<number, (payload: unknown) => void>();
    const undo = () => ({
      operationId: `undo-${calls.length}`,
      expiresAt: Date.now() + 10_000,
    });
    const mutation = () => ({ value: library, undo: undo() });

    Object.defineProperty(window, "__PARTYPASTE_E2E__", {
      value: { calls, library, recent },
    });
    Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
      value: { unregisterListener: (id: number) => callbacks.delete(id) },
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        metadata: {
          currentWindow: {
            label: location.pathname.includes("overlay")
              ? "overlay"
              : "manager",
          },
          currentWebview: {
            label: location.pathname.includes("overlay")
              ? "overlay"
              : "manager",
          },
        },
        transformCallback(callback: (payload: unknown) => void) {
          const id = ++callbackId;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback(id: number) {
          callbacks.delete(id);
        },
        async invoke(command: string, input: Record<string, unknown> = {}) {
          calls.push({ command, input: structuredClone(input) });
          if (command === "get_library") return structuredClone(library);
          if (command === "get_recent_copies") return structuredClone(recent);
          if (command === "get_window_settings") return { alwaysOnTop };
          if (command === "toggle_topmost") {
            alwaysOnTop = Boolean(input.alwaysOnTop);
            return alwaysOnTop;
          }
          if (command === "get_shortcuts")
            return {
              overlay: overlayShortcut,
              phrases: { "phrase-buy": "Ctrl+Alt+1" },
            };
          if (command === "set_overlay_shortcut") {
            overlayShortcut = String(input.shortcut);
            return {
              overlay: overlayShortcut,
              phrases: { "phrase-buy": "Ctrl+Alt+1" },
            };
          }
          if (command === "plugin:app|version") return "0.1.0";
          if (command === "plugin:event|listen") return input.handler;
          if (command === "plugin:event|unlisten") return null;
          if (command === "plugin:dialog|save")
            return "C:\\Temp\\partypaste-backup.json";
          if (command === "plugin:dialog|open")
            return "C:\\Temp\\library-v1.json";
          if (command === "export_backup") return null;
          if (command === "preview_import") {
            backupPreview = {
              path: String(input.path),
              previewToken: "preview-e2e",
            };
            return {
              previewToken: backupPreview.previewToken,
              expiresAt: Date.now() + 60_000,
              gameCount: library.games.length,
              groupCount: library.groups.length,
              phraseCount: library.phrases.length,
              variableDefinitionCount: library.variableDefinitions.length,
              variablePresetCount: library.variablePresets.length,
              phraseVariableRefCount: library.phraseVariableRefs.length,
              shortcutConflictCount: 0,
            };
          }
          if (command === "replace_from_backup") {
            if (
              !backupPreview ||
              input.path !== backupPreview.path ||
              input.previewToken !== backupPreview.previewToken
            ) {
              throw {
                code: "backup_invalid",
                messageKey: "errors.backupInvalid",
                details: { field: "backup" },
              };
            }
            backupPreview = undefined;
            return null;
          }
          if (command === "copy_phrase") {
            const phrase = library.phrases.find(
              (item: { id: string }) => item.id === input.phraseId,
            );
            const values = (input.variables ?? {}) as Record<string, string>;
            const resolvedText = phrase.bodyTemplate.replace(
              /\{([^{}]+)\}/g,
              (_: string, name: string) => values[name] ?? `{${name}}`,
            );
            const item = {
              phraseId: phrase.id,
              title: phrase.title,
              resolvedAt: Date.now(),
              resolvedText,
            };
            recent.unshift(item);
            return structuredClone(item);
          }
          if (command === "set_overlay_display_mode") {
            const game = library.games.find(
              (item: { id: string }) => item.id === input.gameId,
            );
            game.overlayDisplayMode = input.displayMode;
            return structuredClone(game);
          }
          if (command === "set_group_collapsed") {
            const group = library.groups.find(
              (item: { id: string }) => item.id === input.groupId,
            );
            group.collapsed = input.collapsed;
            return structuredClone(group);
          }
          const payload = (input.input ?? {}) as Record<string, unknown>;
          if (command === "create_game")
            library.games.push({
              ...payload,
              sortOrder: library.games.length,
              overlayDisplayMode: "title",
            });
          if (command === "update_game")
            Object.assign(
              library.games.find(
                (item: { id: string }) => item.id === payload.id,
              ),
              payload,
            );
          if (command === "create_group")
            library.groups.push({
              ...payload,
              collapsed: false,
              sortOrder: library.groups.filter(
                (item: { gameId: string }) => item.gameId === payload.gameId,
              ).length,
            });
          if (command === "create_phrase")
            library.phrases.push({
              ...payload,
              favorite: false,
              favoriteOrder: null,
              sortOrder: library.phrases.filter(
                (item: { groupId: string }) => item.groupId === payload.groupId,
              ).length,
            });
          if (command === "update_phrase")
            Object.assign(
              library.phrases.find(
                (item: { id: string }) => item.id === payload.id,
              ),
              payload,
            );
          if (command === "reorder_phrases") {
            (input.orderedIds as string[]).forEach((id, sortOrder) => {
              Object.assign(
                library.phrases.find((item: { id: string }) => item.id === id),
                { sortOrder },
              );
            });
          }
          if (command === "search_phrases") {
            const query = String(input.query).toLocaleLowerCase();
            return structuredClone(
              library.phrases.filter(
                (item: { title: string; bodyTemplate: string }) =>
                  `${item.title} ${item.bodyTemplate}`
                    .toLocaleLowerCase()
                    .includes(query),
              ),
            );
          }
          if (
            command.startsWith("create_") ||
            command.startsWith("update_") ||
            command.startsWith("reorder_") ||
            command === "move_phrase" ||
            command === "set_favorite"
          )
            return mutation();
          if (command === "list_variable_definitions") return [];
          if (command === "get_game_delete_impact")
            return {
              groupCount: 0,
              phraseCount: 0,
              variableDefinitionCount: 0,
              variablePresetCount: 0,
              phraseVariableRefCount: 0,
            };
          if (command === "get_group_delete_impact")
            return { phraseCount: 0, phraseVariableRefCount: 0 };
          return null;
        },
      },
    });
  }, libraryFixture);
}

export async function bridgeCalls(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __PARTYPASTE_E2E__: {
            calls: Array<{ command: string; input: Record<string, unknown> }>;
          };
        }
      ).__PARTYPASTE_E2E__.calls,
  );
}
