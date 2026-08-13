import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WindowSettingsApi } from "../../api/window-settings";
import { SegmentedControl } from "../../components/SegmentedControl";
import { parseTemplate } from "../../domain/template";
import type { GameDto, LibrarySnapshot } from "../library/library-api";
import { CopyFeedback, type CopyFeedbackState } from "./CopyFeedback";
import type { CopySuccessDto, RecentCopyDto } from "./copy-api";
import { OverlayHeader } from "./OverlayHeader";
import { PhraseList } from "./PhraseList";
import { RecentCopies } from "./RecentCopies";
import { TemplateForm } from "./TemplateForm";
import { presetsForPhrase } from "./template-presets";

type Unlisten = () => void;

export interface OverlayLibraryApi {
  getLibrary: () => Promise<LibrarySnapshot>;
  setOverlayDisplayMode: (input: {
    gameId: string;
    displayMode: GameDto["overlayDisplayMode"];
  }) => Promise<unknown>;
  setGroupCollapsed: (input: {
    groupId: string;
    collapsed: boolean;
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
  | { type: "copy_phrase_failed"; phraseId: string }
  | { type: "show_overlay"; openTemplatePhraseId: string | null };

interface CopyRequest {
  phraseId: string;
  variables: Record<string, string>;
}

export interface OverlayAppProps {
  copyApi: OverlayCopyApi;
  libraryApi: OverlayLibraryApi;
  subscribeToShortcutEvents: (
    handler: (event: ShortcutEventPayload) => void,
  ) => Promise<Unlisten>;
  topmostApi: WindowSettingsApi;
}

export function OverlayApp({
  copyApi,
  libraryApi,
  subscribeToShortcutEvents,
  topmostApi,
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
  const [pendingShortcutTemplateId, setPendingShortcutTemplateId] = useState<
    string | null
  >(null);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    new Set(),
  );
  const [failedRequest, setFailedRequest] = useState<CopyRequest | null>(null);
  const requestSequence = useRef(0);
  const templateTrigger = useRef<HTMLButtonElement | null>(null);

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
        if (active) setRecent(items.slice(0, 30));
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
      if (event.type === "copy_phrase_failed") {
        requestSequence.current += 1;
        setFailedRequest({ phraseId: event.phraseId, variables: {} });
        setFeedback("error");
        return;
      }
      if (event.type === "show_overlay" && event.openTemplatePhraseId) {
        setPendingShortcutTemplateId(event.openTemplatePhraseId);
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

  useEffect(() => {
    if (!library || !pendingShortcutTemplateId) return;
    const phrase = library.phrases.find(
      ({ id }) => id === pendingShortcutTemplateId,
    );
    const group = library.groups.find(({ id }) => id === phrase?.groupId);
    if (!phrase || !group) return;
    setSelectedGameId(group.gameId);
    templateTrigger.current = null;
    setExpandedGroupIds((current) => new Set(current).add(group.id));
    setOpenTemplatePhraseId(phrase.id);
    setShortcutOpenedTemplateId(phrase.id);
    setPendingShortcutTemplateId(null);
  }, [library, pendingShortcutTemplateId]);

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
        group: expandedGroupIds.has(group.id)
          ? { ...group, collapsed: false }
          : group,
        phrases: phrases
          .filter(({ groupId }) => groupId === group.id)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      })) ?? [];
  const openTemplate = phrases.find(({ id }) => id === openTemplatePhraseId);
  const templatePresets = useMemo(
    () =>
      library && openTemplate ? presetsForPhrase(library, openTemplate) : {},
    [library, openTemplate],
  );

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
      .setGroupCollapsed({ groupId: group.id, collapsed })
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

  const copyRequest = useCallback(
    async (request: CopyRequest) => {
      const sequence = ++requestSequence.current;
      try {
        await copyApi.copyPhrase(request);
        if (sequence !== requestSequence.current) return false;
        try {
          const items = await copyApi.getRecentCopies();
          if (sequence !== requestSequence.current) return false;
          setRecent(items.slice(0, 30));
        } catch {
          // Clipboard success remains success even if session history cannot refresh.
        }
        setFailedRequest(null);
        setFeedback("success");
        return true;
      } catch {
        if (sequence !== requestSequence.current) return false;
        setFailedRequest({
          phraseId: request.phraseId,
          variables: { ...request.variables },
        });
        setFeedback("error");
        return false;
      }
    },
    [copyApi],
  );

  useEffect(() => {
    if (feedback !== "success") return;
    const timeout = window.setTimeout(() => setFeedback("idle"), 1_500);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  function closeTemplate() {
    setOpenTemplatePhraseId(null);
    setShortcutOpenedTemplateId(null);
    const trigger = templateTrigger.current;
    window.setTimeout(() => trigger?.focus(), 0);
  }

  function openPhrase(
    phrase: LibrarySnapshot["phrases"][number],
    trigger: HTMLButtonElement,
  ) {
    if (
      parseTemplate(phrase.bodyTemplate).tokens.some(
        ({ type }) => type === "variable",
      )
    ) {
      templateTrigger.current = trigger;
      setOpenTemplatePhraseId(phrase.id);
      setShortcutOpenedTemplateId(null);
      return;
    }
    void copyRequest({ phraseId: phrase.id, variables: {} });
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
          topmostApi={topmostApi}
        />
      ) : (
        <OverlayHeader
          games={[]}
          onSelectGame={() => undefined}
          selectedGameId=""
          topmostApi={topmostApi}
        />
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
                  onClose={closeTemplate}
                  onCopy={async (variables) => {
                    const copied = await copyRequest({
                      phraseId: openTemplate.id,
                      variables,
                    });
                    if (copied) closeTemplate();
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
          if (failedRequest) void copyRequest(failedRequest);
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
