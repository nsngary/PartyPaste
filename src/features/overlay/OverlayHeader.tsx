import { Pin, PinOff } from "lucide-react";
import { useEffect, useState } from "react";
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
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setPending(true);
    void topmostApi
      .getWindowSettings()
      .then((settings) => {
        if (active) setAlwaysOnTop(settings.alwaysOnTop);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [topmostApi]);

  async function changeTopmost() {
    const previous = alwaysOnTop;
    setPending(true);
    setError(false);
    try {
      setAlwaysOnTop(await topmostApi.toggleTopmost(!previous));
    } catch {
      setAlwaysOnTop(previous);
      setError(true);
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
        aria-pressed={alwaysOnTop}
        disabled={pending}
        icon={alwaysOnTop ? <PinOff size={16} /> : <Pin size={16} />}
        label={t(alwaysOnTop ? "overlay.unpin" : "overlay.pin")}
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
