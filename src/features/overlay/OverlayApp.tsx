import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "../../components/SegmentedControl";
import { parseTemplate } from "../../domain/template";
import type { GameDto, LibrarySnapshot } from "../library/library-api";
import { CopyFeedback, type CopyFeedbackState } from "./CopyFeedback";
import type { CopySuccessDto, RecentCopyDto } from "./copy-api";
import { OverlayHeader } from "./OverlayHeader";
import { PhraseList } from "./PhraseList";
import { RecentCopies } from "./RecentCopies";
import { TemplateForm } from "./TemplateForm";

type Unlisten = () => void;

export interface OverlayLibraryApi {
  getLibrary: () => Promise<LibrarySnapshot>;
  setOverlayDisplayMode: (input: {
    gameId: string;
    displayMode: GameDto["overlayDisplayMode"];
  }) => Promise<unknown>;
  updateGroup: (input: {
    input: { id: string; name: string; collapsed: boolean };
  }) => Promise<unknown>;
}

export interface OverlayCopyApi {
  copyPhrase: (input: {
    phraseId: string;
    variables: Record<string, string>;
  }) => Promise<CopySuccessDto>;
  getRecentCopies: () => Promise<RecentCopyDto[]>;
}

export type ShortcutEventPayload =
  | { type: "copy_phrase"; phraseId: string }
  | { type: "show_overlay"; openTemplatePhraseId: string | null };

export interface OverlayAppProps {
  copyApi: OverlayCopyApi;
  libraryApi: OverlayLibraryApi;
  subscribeToShortcutEvents: (
    handler: (event: ShortcutEventPayload) => void,
  ) => Promise<Unlisten>;
}

export function OverlayApp({
  copyApi,
  libraryApi,
  subscribeToShortcutEvents,
}: OverlayAppProps) {
  const { t } = useTranslation();
  const [library, setLibrary] = useState<LibrarySnapshot | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentCopyDto[]>([]);
  const [feedback, setFeedback] = useState<CopyFeedbackState>("idle");
  const [preferenceError, setPreferenceError] = useState(false);
  const [openTemplatePhraseId, setOpenTemplatePhraseId] = useState<
    string | null
  >(null);
  const [shortcutOpenedTemplateId, setShortcutOpenedTemplateId] = useState<
    string | null
  >(null);
  const retryPhraseId = useRef<string | null>(null);
  const libraryRef = useRef<LibrarySnapshot | null>(null);

  libraryRef.current = library;

  useEffect(() => {
    let active = true;
    void libraryApi
      .getLibrary()
      .then((snapshot) => {
        if (!active) return;
        setLibrary(snapshot);
        setSelectedGameId(
          (current) => current ?? snapshot.games[0]?.id ?? null,
        );
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [libraryApi]);

  useEffect(() => {
    let active = true;
    void copyApi
      .getRecentCopies()
      .then((items) => {
        if (active) setRecent(items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [copyApi]);

  useEffect(() => {
    let active = true;
    let unlisten: Unlisten | undefined;
    void subscribeToShortcutEvents((event) => {
      if (!active) return;
      if (event.type === "copy_phrase") {
        setFeedback("success");
        void copyApi
          .getRecentCopies()
          .then((items) => {
            if (active) {
              setRecent(items);
            }
          })
          .catch(() => undefined);
        return;
      }
      if (event.type === "show_overlay" && event.openTemplatePhraseId) {
        const snapshot = libraryRef.current;
        const phrase = snapshot?.phrases.find(
          ({ id }) => id === event.openTemplatePhraseId,
        );
        const group = snapshot?.groups.find(({ id }) => id === phrase?.groupId);
        if (group) setSelectedGameId(group.gameId);
        setOpenTemplatePhraseId(event.openTemplatePhraseId);
        setShortcutOpenedTemplateId(event.openTemplatePhraseId);
      }
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [copyApi, subscribeToShortcutEvents]);

  const selectedGame = library?.games.find(({ id }) => id === selectedGameId);
  const gameGroupIds = useMemo(
    () =>
      new Set(
        library?.groups
          .filter(({ gameId }) => gameId === selectedGameId)
          .map(({ id }) => id) ?? [],
      ),
    [library, selectedGameId],
  );
  const phrases =
    library?.phrases.filter(({ groupId }) => gameGroupIds.has(groupId)) ?? [];
  const groups =
    library?.groups
      .filter(({ gameId }) => gameId === selectedGameId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((group) => ({
        group,
        phrases: phrases
          .filter(({ groupId }) => groupId === group.id)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      })) ?? [];
  const openTemplate = phrases.find(({ id }) => id === openTemplatePhraseId);
  const templatePresets = useMemo(() => {
    const definitions = new Map(
      (library?.variableDefinitions ?? [])
        .filter(({ gameId }) => gameId === selectedGameId)
        .map((definition) => [definition.id, definition]),
    );
    const values: Record<string, string[]> = {};
    for (const preset of library?.variablePresets ?? []) {
      const definition = definitions.get(preset.variableDefinitionId);
      if (!definition) continue;
      const existingValues = values[definition.name] ?? [];
      existingValues.push(preset.value);
      values[definition.name] = existingValues;
    }
    return values;
  }, [library, selectedGameId]);

  function selectDisplayMode(mode: GameDto["overlayDisplayMode"]) {
    if (!library || !selectedGame || mode === selectedGame.overlayDisplayMode)
      return;
    const gameId = selectedGame.id;
    setLibrary({
      ...library,
      games: library.games.map((game) =>
        game.id === gameId ? { ...game, overlayDisplayMode: mode } : game,
      ),
    });
    setPreferenceError(false);
    void libraryApi
      .setOverlayDisplayMode({ gameId, displayMode: mode })
      .catch(() => {
        setLibrary((current) =>
          current
            ? {
                ...current,
                games: current.games.map((game) =>
                  game.id === gameId
                    ? {
                        ...game,
                        overlayDisplayMode: selectedGame.overlayDisplayMode,
                      }
                    : game,
                ),
              }
            : current,
        );
        setPreferenceError(true);
      });
  }

  function toggleGroup(group: LibrarySnapshot["groups"][number]) {
    if (!library) return;
    const collapsed = !group.collapsed;
    setLibrary({
      ...library,
      groups: library.groups.map((candidate) =>
        candidate.id === group.id ? { ...candidate, collapsed } : candidate,
      ),
    });
    setPreferenceError(false);
    void libraryApi
      .updateGroup({
        input: { id: group.id, name: group.name, collapsed },
      })
      .catch(() => {
        setLibrary((current) =>
          current
            ? {
                ...current,
                groups: current.groups.map((candidate) =>
                  candidate.id === group.id ? group : candidate,
                ),
              }
            : current,
        );
        setPreferenceError(true);
      });
  }

  const copyPlainPhrase = useCallback(
    async (phraseId: string) => {
      retryPhraseId.current = phraseId;
      try {
        const result = await copyApi.copyPhrase({ phraseId, variables: {} });
        setRecent((items) => [
          result,
          ...items.filter((item) => item.resolvedAt !== result.resolvedAt),
        ]);
        setFeedback("success");
      } catch {
        setFeedback("error");
      }
    },
    [copyApi],
  );

  useEffect(() => {
    if (feedback !== "success") return;
    const timeout = window.setTimeout(() => setFeedback("idle"), 1_500);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  function openPhrase(phrase: LibrarySnapshot["phrases"][number]) {
    if (
      parseTemplate(phrase.bodyTemplate).tokens.some(
        ({ type }) => type === "variable",
      )
    ) {
      setOpenTemplatePhraseId(phrase.id);
      setShortcutOpenedTemplateId(null);
      return;
    }
    void copyPlainPhrase(phrase.id);
  }

  return (
    <main className="pp-overlay">
      {library && library.games.length > 0 ? (
        <OverlayHeader
          games={library.games}
          onSelectGame={(gameId) => {
            setSelectedGameId(gameId);
            setOpenTemplatePhraseId(null);
          }}
          selectedGameId={selectedGameId ?? ""}
        />
      ) : (
        <header className="pp-overlay__header">
          <strong className="pp-brand-label">{t("app.brand")}</strong>
        </header>
      )}

      {loadError ? (
        <p role="alert">{t("overlay.loadFailed")}</p>
      ) : !library ? (
        <p role="status">{t("overlay.loading")}</p>
      ) : library.games.length === 0 ? (
        <p>{t("overlay.noGames")}</p>
      ) : (
        <>
          <SegmentedControl
            ariaLabel={t("overlay.displayMode")}
            value={selectedGame?.overlayDisplayMode ?? "title"}
            onChange={selectDisplayMode}
            options={[
              { value: "title", label: t("overlay.titleOnly") },
              { value: "full", label: t("overlay.fullSentence") },
            ]}
          />
          <PhraseList
            groups={groups}
            mode={selectedGame?.overlayDisplayMode ?? "title"}
            onOpenPhrase={openPhrase}
            onToggleGroup={toggleGroup}
            renderAfterPhrase={(phrase) =>
              openTemplate?.id === phrase.id ? (
                <TemplateForm
                  autoFocus={shortcutOpenedTemplateId === openTemplate.id}
                  bodyTemplate={openTemplate.bodyTemplate}
                  key={openTemplate.id}
                  onClose={() => {
                    setOpenTemplatePhraseId(null);
                    setShortcutOpenedTemplateId(null);
                  }}
                  onCopy={async (variables) => {
                    retryPhraseId.current = openTemplate.id;
                    try {
                      const result = await copyApi.copyPhrase({
                        phraseId: openTemplate.id,
                        variables,
                      });
                      setRecent((items) => [result, ...items]);
                      setFeedback("success");
                      setOpenTemplatePhraseId(null);
                    } catch {
                      setFeedback("error");
                    }
                  }}
                  presets={templatePresets}
                  title={openTemplate.title}
                />
              ) : null
            }
          />
          <RecentCopies recent={recent} />
        </>
      )}
      <CopyFeedback
        state={feedback}
        onRetry={() => {
          const phraseId = retryPhraseId.current;
          if (phraseId) void copyPlainPhrase(phraseId);
        }}
      />
      {preferenceError ? (
        <p className="pp-overlay__preference-error" role="alert">
          {t("overlay.preferenceSaveFailed")}
        </p>
      ) : null}
    </main>
  );
}
