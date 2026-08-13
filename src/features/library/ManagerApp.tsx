import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Drawer } from "../../components/Drawer";
import { Field } from "../../components/Field";
import { parseTemplate } from "../../domain/template";
import { validateGameName, validateGroupName } from "../../domain/validation";
import { SettingsPage } from "../settings/SettingsPage";
import {
  VariableLibrary,
  type VariableLibraryApi,
} from "../variables/VariableLibrary";
import { DeleteConfirm } from "./DeleteConfirm";
import { GameSidebar, type ManagerSection } from "./GameSidebar";
import { GroupSection } from "./GroupSection";
import type {
  GameDeleteImpact,
  GameDto,
  GroupDeleteImpact,
  GroupDto,
  LibrarySnapshot,
  PhraseDto,
  UndoReceipt,
} from "./library-api";
import { type PhraseDraft, PhraseInspector } from "./PhraseInspector";
import { type PhraseFilters, PhraseToolbar } from "./PhraseToolbar";
import { UndoToast } from "./UndoToast";

interface UndoMutation {
  undo: UndoReceipt;
}
export interface ManagerLibraryApi extends VariableLibraryApi {
  createGame(input: {
    input: { id: string; name: string };
  }): Promise<UndoMutation>;
  createGroup(input: {
    input: { id: string; gameId: string; name: string };
  }): Promise<UndoMutation>;
  createPhrase(input: {
    input: {
      id: string;
      groupId: string;
      title: string;
      bodyTemplate: string;
      hotkey?: string | null;
    };
  }): Promise<UndoMutation>;
  deleteGame(input: { gameId: string }): Promise<UndoMutation>;
  deleteGroup(input: { groupId: string }): Promise<UndoMutation>;
  deletePhrase(input: { phraseId: string }): Promise<UndoMutation>;
  duplicatePhrase(input: {
    phraseId: string;
    newPhraseId: string;
  }): Promise<UndoMutation>;
  getGameDeleteImpact(input: { gameId: string }): Promise<GameDeleteImpact>;
  getGroupDeleteImpact(input: { groupId: string }): Promise<GroupDeleteImpact>;
  getLibrary(): Promise<LibrarySnapshot>;
  movePhrase(input: {
    phraseId: string;
    targetGroupId: string;
    targetIndex: number;
  }): Promise<UndoMutation>;
  reorderFavorites(input: {
    gameId: string;
    orderedIds: string[];
  }): Promise<UndoMutation>;
  reorderGames(input: { orderedIds: string[] }): Promise<UndoMutation>;
  reorderGroups(input: {
    gameId: string;
    orderedIds: string[];
  }): Promise<UndoMutation>;
  reorderPhrases(input: {
    groupId: string;
    orderedIds: string[];
  }): Promise<UndoMutation>;
  searchPhrases(input: { gameId: string; query: string }): Promise<PhraseDto[]>;
  setFavorite(input: {
    phraseId: string;
    favorite: boolean;
  }): Promise<UndoMutation>;
  setGroupCollapsed?(input: {
    groupId: string;
    collapsed: boolean;
  }): Promise<unknown>;
  undoOperation(input: { operationId: string }): Promise<LibrarySnapshot>;
  updateGame(input: {
    input: { id: string; name: string };
  }): Promise<UndoMutation>;
  updateGroup(input: {
    input: { id: string; name: string; collapsed: boolean };
  }): Promise<UndoMutation>;
  updatePhrase(input: {
    input: {
      id: string;
      title: string;
      bodyTemplate: string;
      hotkey: string | null;
    };
  }): Promise<UndoMutation>;
}

export interface ManagerAppProps {
  libraryApi: ManagerLibraryApi;
  subscribeToOpenUpdateSettings?: (handler: () => void) => Promise<() => void>;
}
type NameDialog =
  | { kind: "game"; item: GameDto | null }
  | { kind: "group"; item: GroupDto | null };
type DeleteTarget =
  | { kind: "game"; item: GameDto; impact: GameDeleteImpact }
  | { kind: "group"; item: GroupDto; impact: GroupDeleteImpact }
  | { kind: "phrase"; item: PhraseDto };
function newId(prefix: string) {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
function useWindowWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return width;
}

function mergeVisibleOrder(
  allIds: readonly string[],
  visibleIds: readonly string[],
) {
  const visible = new Set(visibleIds);
  let index = 0;
  return allIds.map((id) => (visible.has(id) ? visibleIds[index++] : id));
}

export function ManagerApp({
  libraryApi,
  subscribeToOpenUpdateSettings,
}: ManagerAppProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const width = useWindowWidth();
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const queryKey = ["library", selectedGameId ?? "initial"] as const;
  const libraryQuery = useQuery({
    queryKey,
    queryFn: () => libraryApi.getLibrary(),
    placeholderData: (previous) => previous,
  });
  const library = libraryQuery.data;
  const [section, setSection] = useState<ManagerSection>("phrases");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<PhraseDto[] | null>(null);
  const [filters, setFilters] = useState<PhraseFilters>({
    favorites: false,
    templates: false,
    shortcuts: false,
  });
  const [selectedPhrase, setSelectedPhrase] = useState<PhraseDto | null>(null);
  const [draftGroupId, setDraftGroupId] = useState<string | null>(null);
  const [inspectorDirty, setInspectorDirty] = useState(false);
  const [discardDrawerOpen, setDiscardDrawerOpen] = useState(false);
  const inspectorTriggerRef = useRef<HTMLElement | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [undo, setUndo] = useState<UndoReceipt | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!subscribeToOpenUpdateSettings) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void subscribeToOpenUpdateSettings(() => setSection("settings"))
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [subscribeToOpenUpdateSettings]);

  useEffect(() => {
    if (!selectedGameId && library?.games[0])
      setSelectedGameId(library.games[0].id);
    else if (
      selectedGameId &&
      library &&
      !library.games.some(({ id }) => id === selectedGameId)
    )
      setSelectedGameId(library.games[0]?.id ?? null);
  }, [library, selectedGameId]);
  useEffect(() => {
    if (!selectedGameId || !search.trim()) {
      setSearchResults(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void libraryApi
        .searchPhrases({ gameId: selectedGameId, query: search })
        .then((items) => {
          if (active) setSearchResults(items);
        })
        .catch(() => {
          if (active) setOperationError(t("manager.searchFailed"));
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [libraryApi, search, selectedGameId, t]);

  const gameGroups = useMemo(
    () =>
      library?.groups
        .filter(({ gameId }) => gameId === selectedGameId)
        .sort((a, b) => a.sortOrder - b.sortOrder) ?? [],
    [library, selectedGameId],
  );
  const groupIds = useMemo(
    () => new Set(gameGroups.map(({ id }) => id)),
    [gameGroups],
  );
  const visiblePhrases = useMemo(() => {
    const source =
      searchResults ??
      library?.phrases.filter(({ groupId }) => groupIds.has(groupId)) ??
      [];
    return source.filter(
      (phrase) =>
        (!filters.favorites || phrase.favorite) &&
        (!filters.templates ||
          parseTemplate(phrase.bodyTemplate).tokens.some(
            ({ type }) => type === "variable",
          )) &&
        (!filters.shortcuts || Boolean(phrase.hotkey)),
    );
  }, [filters, groupIds, library, searchResults]);
  const favoriteIds = useMemo(
    () =>
      (library?.phrases ?? [])
        .filter(({ favorite, groupId }) => favorite && groupIds.has(groupId))
        .sort((a, b) => (a.favoriteOrder ?? 0) - (b.favoriteOrder ?? 0))
        .map(({ id }) => id),
    [groupIds, library?.phrases],
  );

  async function finishMutation(promise: Promise<UndoMutation>) {
    try {
      const result = await promise;
      setUndo(result.undo);
      setOperationError(null);
      await queryClient.invalidateQueries({ exact: true, queryKey });
      return true;
    } catch {
      setOperationError(t("manager.operationFailed"));
      return false;
    }
  }
  function openNameDialog(dialog: NameDialog) {
    setNameDialog(dialog);
    setName(dialog.item?.name ?? "");
    setNameError(null);
  }
  async function saveName() {
    if (!nameDialog) return;
    const dialog = nameDialog;
    if (dialog.kind === "group" && !selectedGameId) return;
    const validation =
      dialog.kind === "game" ? validateGameName(name) : validateGroupName(name);
    if (!validation.ok) {
      setNameError(
        validation.reason === "too_long"
          ? t("manager.nameTooLong")
          : t("manager.nameRequired"),
      );
      return;
    }
    setNameDialog(null);
    if (dialog.kind === "game") {
      await finishMutation(
        dialog.item
          ? libraryApi.updateGame({
              input: { id: dialog.item.id, name: validation.value },
            })
          : libraryApi.createGame({
              input: { id: newId("game"), name: validation.value },
            }),
      );
    } else {
      const gameId = selectedGameId;
      if (!gameId) return;
      await finishMutation(
        dialog.item
          ? libraryApi.updateGroup({
              input: {
                id: dialog.item.id,
                name: validation.value,
                collapsed: collapsed[dialog.item.id] ?? dialog.item.collapsed,
              },
            })
          : libraryApi.createGroup({
              input: {
                id: newId("group"),
                gameId,
                name: validation.value,
              },
            }),
      );
    }
  }
  async function requestDelete(
    target: GameDto | GroupDto | PhraseDto,
    kind: DeleteTarget["kind"],
  ) {
    if (kind === "game")
      setDeleteTarget({
        kind,
        item: target as GameDto,
        impact: await libraryApi.getGameDeleteImpact({ gameId: target.id }),
      });
    else if (kind === "group")
      setDeleteTarget({
        kind,
        item: target as GroupDto,
        impact: await libraryApi.getGroupDeleteImpact({ groupId: target.id }),
      });
    else setDeleteTarget({ kind, item: target as PhraseDto });
  }
  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    if (target.kind === "game")
      await finishMutation(libraryApi.deleteGame({ gameId: target.item.id }));
    else if (target.kind === "group")
      await finishMutation(libraryApi.deleteGroup({ groupId: target.item.id }));
    else
      await finishMutation(
        libraryApi.deletePhrase({ phraseId: target.item.id }),
      );
  }
  function openPhrase(
    phrase: PhraseDto | null,
    groupId: string,
    trigger?: HTMLElement,
  ) {
    inspectorTriggerRef.current =
      trigger ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setSelectedPhrase(phrase);
    setDraftGroupId(groupId);
  }
  function closeInspector() {
    const trigger = inspectorTriggerRef.current;
    setSelectedPhrase(null);
    setDraftGroupId(null);
    setInspectorDirty(false);
    window.setTimeout(() => trigger?.focus(), 0);
  }
  async function savePhrase(draft: PhraseDraft) {
    if (!draftGroupId) return;
    const saved = selectedPhrase
      ? await finishMutation(
          libraryApi.updatePhrase({
            input: { id: selectedPhrase.id, ...draft },
          }),
        )
      : await finishMutation(
          libraryApi.createPhrase({
            input: { id: newId("phrase"), groupId: draftGroupId, ...draft },
          }),
        );
    if (saved) closeInspector();
  }
  const inspector = draftGroupId ? (
    <PhraseInspector
      onCancel={closeInspector}
      onDirtyChange={setInspectorDirty}
      onSave={savePhrase}
      phrase={selectedPhrase}
    />
  ) : null;

  if (libraryQuery.isLoading)
    return (
      <main className="pp-manager pp-manager--loading">
        <p role="status">{t("manager.loadingLibrary")}</p>
      </main>
    );
  if (libraryQuery.isError || !library)
    return (
      <main className="pp-manager pp-manager--loading">
        <p role="alert">{t("manager.libraryLoadFailed")}</p>
      </main>
    );
  const selectedGame =
    library.games.find(({ id }) => id === selectedGameId) ?? null;
  return (
    <main
      className={`pp-manager${section === "phrases" ? "" : " pp-manager--wide-content"}`}
    >
      <GameSidebar
        games={library.games}
        onCreateGame={() => openNameDialog({ kind: "game", item: null })}
        onDeleteGame={(game) => void requestDelete(game, "game")}
        onEditGame={(game) => openNameDialog({ kind: "game", item: game })}
        onReorderGames={(orderedIds) =>
          void finishMutation(libraryApi.reorderGames({ orderedIds }))
        }
        onSelectGame={(id) => {
          setSelectedGameId(id);
          closeInspector();
        }}
        onSelectSection={setSection}
        section={section}
        selectedGameId={selectedGameId}
      />
      <section className="pp-manager__content">
        {section === "settings" ? (
          <SettingsPage />
        ) : !selectedGame ? (
          <div className="pp-manager__empty">
            <h1>{t("manager.noGames")}</h1>
            <Button
              onClick={() => openNameDialog({ kind: "game", item: null })}
            >
              {t("manager.newGame")}
            </Button>
          </div>
        ) : section === "variables" ? (
          <VariableLibrary
            api={libraryApi}
            gameId={selectedGame.id}
            onUndoReceipt={setUndo}
          />
        ) : (
          <>
            <PhraseToolbar
              filters={filters}
              onChangeFilters={setFilters}
              onChangeSearch={setSearch}
              onNewPhrase={() =>
                gameGroups[0] && openPhrase(null, gameGroups[0].id)
              }
              search={search}
            />
            <div className="pp-content-actions">
              <Button
                onClick={() => openNameDialog({ kind: "group", item: null })}
                variant="secondary"
              >
                {t("manager.newGroup")}
              </Button>
            </div>
            <div className="pp-groups">
              {(filters.favorites
                ? [
                    {
                      id: "__favorites",
                      gameId: selectedGame.id,
                      name: t("manager.favorites"),
                      collapsed: false,
                      sortOrder: 0,
                    },
                  ]
                : gameGroups
              ).map((group, groupIndex) => {
                const synthetic = group.id === "__favorites";
                const rendered = {
                  ...group,
                  collapsed: collapsed[group.id] ?? group.collapsed,
                };
                const phrases = synthetic
                  ? [...visiblePhrases]
                      .sort(
                        (a, b) =>
                          (a.favoriteOrder ?? 0) - (b.favoriteOrder ?? 0),
                      )
                      .map((phrase) => ({
                        ...phrase,
                        sortOrder: phrase.favoriteOrder ?? 0,
                      }))
                  : visiblePhrases.filter(
                      ({ groupId }) => groupId === group.id,
                    );
                return (
                  <GroupSection
                    allGroups={gameGroups}
                    group={rendered}
                    key={group.id}
                    onCreatePhrase={() => openPhrase(null, group.id)}
                    onDeleteGroup={() => void requestDelete(group, "group")}
                    onDeletePhrase={(phrase) =>
                      void requestDelete(phrase, "phrase")
                    }
                    onDuplicatePhrase={(phrase) =>
                      void finishMutation(
                        libraryApi.duplicatePhrase({
                          phraseId: phrase.id,
                          newPhraseId: newId("phrase"),
                        }),
                      )
                    }
                    onEditGroup={() =>
                      openNameDialog({ kind: "group", item: group })
                    }
                    onEditPhrase={(phrase, trigger) =>
                      openPhrase(phrase, group.id, trigger)
                    }
                    onMovePhrase={(phraseId, targetGroupId, targetIndex) =>
                      void finishMutation(
                        libraryApi.movePhrase({
                          phraseId,
                          targetGroupId,
                          targetIndex,
                        }),
                      )
                    }
                    onMoveGroup={(delta) => {
                      const targetIndex = Math.max(
                        0,
                        Math.min(gameGroups.length - 1, groupIndex + delta),
                      );
                      const next = [...gameGroups];
                      const [item] = next.splice(groupIndex, 1);
                      next.splice(targetIndex, 0, item);
                      void finishMutation(
                        libraryApi.reorderGroups({
                          gameId: selectedGame.id,
                          orderedIds: next.map(({ id }) => id),
                        }),
                      );
                    }}
                    onReorderPhrases={(orderedIds) =>
                      void finishMutation(
                        synthetic
                          ? libraryApi.reorderFavorites({
                              gameId: selectedGame.id,
                              orderedIds: mergeVisibleOrder(
                                favoriteIds,
                                orderedIds,
                              ),
                            })
                          : libraryApi.reorderPhrases({
                              groupId: group.id,
                              orderedIds: mergeVisibleOrder(
                                library.phrases
                                  .filter(({ groupId }) => groupId === group.id)
                                  .sort((a, b) => a.sortOrder - b.sortOrder)
                                  .map(({ id }) => id),
                                orderedIds,
                              ),
                            }),
                      )
                    }
                    onToggleFavorite={(phrase) =>
                      void finishMutation(
                        libraryApi.setFavorite({
                          phraseId: phrase.id,
                          favorite: !phrase.favorite,
                        }),
                      )
                    }
                    onToggleGroup={() => {
                      if (synthetic) return;
                      const next = !rendered.collapsed;
                      setCollapsed((current) => ({
                        ...current,
                        [group.id]: next,
                      }));
                      void libraryApi.setGroupCollapsed?.({
                        groupId: group.id,
                        collapsed: next,
                      });
                    }}
                    phrases={phrases}
                    synthetic={synthetic}
                  />
                );
              })}
            </div>
          </>
        )}
      </section>
      {section === "phrases" && width >= 1000 ? (
        <section
          aria-label={t("manager.inspector")}
          className="pp-manager__inspector"
        >
          <header>
            <h2>{t("manager.inspector")}</h2>
          </header>
          {inspector ?? <p className="pp-empty">{t("manager.selectPhrase")}</p>}
        </section>
      ) : null}
      {section === "phrases" && width < 1000 ? (
        <Drawer
          description={t("manager.inspectorDescription")}
          onClose={() =>
            inspectorDirty ? setDiscardDrawerOpen(true) : closeInspector()
          }
          open={Boolean(inspector)}
          title={t("manager.inspector")}
        >
          {inspector}
        </Drawer>
      ) : null}
      <Dialog
        footer={
          <>
            <Button
              onClick={() => setDiscardDrawerOpen(false)}
              variant="secondary"
            >
              {t("manager.keepEditing")}
            </Button>
            <Button
              onClick={() => {
                setDiscardDrawerOpen(false);
                closeInspector();
              }}
              variant="danger"
            >
              {t("manager.discard")}
            </Button>
          </>
        }
        onClose={() => setDiscardDrawerOpen(false)}
        open={discardDrawerOpen}
        title={t("manager.discardChanges")}
      >
        <p>{t("manager.unsavedChangesLost")}</p>
      </Dialog>
      <Dialog
        footer={
          <>
            <Button onClick={() => setNameDialog(null)} variant="secondary">
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void saveName()}>{t("common.save")}</Button>
          </>
        }
        onClose={() => setNameDialog(null)}
        open={nameDialog !== null}
        title={
          nameDialog?.kind === "game"
            ? nameDialog.item
              ? t("manager.editGame")
              : t("manager.newGame")
            : nameDialog?.item
              ? t("manager.editGroup")
              : t("manager.newGroup")
        }
      >
        <Field
          error={nameError}
          label={
            nameDialog?.kind === "game"
              ? t("manager.gameName")
              : t("manager.groupName")
          }
          required
        >
          <input
            autoFocus
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </Field>
      </Dialog>
      <DeleteConfirm
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        open={deleteTarget !== null}
        title={
          deleteTarget?.kind === "game"
            ? t("manager.deleteGame")
            : deleteTarget?.kind === "group"
              ? t("manager.deleteGroup")
              : t("manager.deletePhrase")
        }
      >
        {deleteTarget?.kind === "game"
          ? t("manager.gameDeleteImpact", {
              groupCount: deleteTarget.impact.groupCount,
              phraseCount: deleteTarget.impact.phraseCount,
              variableCount: deleteTarget.impact.variableDefinitionCount,
              presetCount: deleteTarget.impact.variablePresetCount,
            })
          : deleteTarget?.kind === "group"
            ? t("manager.groupDeleteImpact", {
                phraseCount: deleteTarget.impact.phraseCount,
                referenceCount: deleteTarget.impact.phraseVariableRefCount,
              })
            : t("manager.deletePhraseDescription")}
      </DeleteConfirm>
      <UndoToast
        onDismiss={() => setUndo(null)}
        onUndo={async (operationId) => {
          const snapshot = await libraryApi.undoOperation({ operationId });
          queryClient.setQueryData(queryKey, snapshot);
          setUndo(null);
        }}
        receipt={undo}
      />
      {operationError ? (
        <div className="pp-manager__error" role="alert">
          {operationError}
        </div>
      ) : null}
    </main>
  );
}
