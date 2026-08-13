import { Pin, PinOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WindowSettingsApi } from "../../api/window-settings";
import { IconButton } from "../../components/IconButton";
import type { GameDto } from "../library/library-api";

export type OverlayTopmostApi = WindowSettingsApi;

export interface OverlayHeaderProps {
  games: readonly GameDto[];
  onSelectGame: (gameId: string) => void;
  selectedGameId: string;
  topmostApi: OverlayTopmostApi;
}

export function OverlayHeader({
  games,
  onSelectGame,
  selectedGameId,
  topmostApi,
}: OverlayHeaderProps) {
  const { t } = useTranslation();
  const [alwaysOnTop, setAlwaysOnTop] = useState<boolean | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState(false);
  const confirmedSequence = useRef(0);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const loadSequence = confirmedSequence.current;
    setPending(true);
    void topmostApi
      .subscribeToWindowSettings?.((settings) => {
        if (!active) return;
        confirmedSequence.current += 1;
        setAlwaysOnTop(settings.alwaysOnTop);
        setError(false);
      })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      });
    void topmostApi
      .getWindowSettings()
      .then((settings) => {
        if (active && loadSequence === confirmedSequence.current) {
          setAlwaysOnTop(settings.alwaysOnTop);
        }
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [topmostApi]);

  async function changeTopmost() {
    if (alwaysOnTop === null) return;
    const previous = alwaysOnTop;
    const mutationSequence = confirmedSequence.current;
    setPending(true);
    setError(false);
    try {
      const confirmed = await topmostApi.toggleTopmost(!previous);
      if (mutationSequence === confirmedSequence.current) {
        setAlwaysOnTop(confirmed);
      }
    } catch {
      if (mutationSequence === confirmedSequence.current) {
        setAlwaysOnTop(previous);
        setError(true);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <header className="pp-overlay__header" data-tauri-drag-region>
      <strong className="pp-brand-label" data-tauri-drag-region>
        {t("app.brand")}
      </strong>
      <label className="pp-overlay__game-select">
        <span className="pp-visually-hidden">{t("manager.games")}</span>
        <select
          aria-label={t("manager.games")}
          value={selectedGameId}
          onChange={(event) => onSelectGame(event.target.value)}
        >
          {games.map((game) => (
            <option key={game.id} value={game.id}>
              {game.name}
            </option>
          ))}
        </select>
      </label>
      <IconButton
        aria-pressed={alwaysOnTop ?? undefined}
        disabled={pending}
        icon={alwaysOnTop ? <PinOff size={16} /> : <Pin size={16} />}
        label={t(
          alwaysOnTop === null
            ? "overlay.topmostLoading"
            : alwaysOnTop
              ? "overlay.unpin"
              : "overlay.pin",
        )}
        onClick={() => void changeTopmost()}
        variant="outlined"
      />
      {error ? (
        <span className="pp-overlay__topmost-error" role="alert">
          {t("overlay.preferenceSaveFailed")}
        </span>
      ) : null}
    </header>
  );
}
