import { Pin, PinOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWindowSettings } from "../../api/useWindowSettings";
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

  const {
    alwaysOnTop,
    error,
    pending,
    retry,
    toggle,
  } = useWindowSettings(topmostApi);

  return (
    <header
      className="pp-overlay__header"
      data-tauri-drag-region
    >
      <strong
        className="pp-brand-label"
        data-tauri-drag-region
      >
        {t("app.brand")}
      </strong>

      <label className="pp-overlay__game-select">
        <span className="pp-visually-hidden">
          {t("manager.games")}
        </span>

        <select
          aria-label={t("manager.games")}
          value={selectedGameId}
          onChange={(event) =>
            onSelectGame(event.target.value)
          }
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
        disabled={pending || alwaysOnTop === null}
        icon={
          alwaysOnTop ? (
            <PinOff size={16} />
          ) : (
            <Pin size={16} />
          )
        }
        label={t(
          alwaysOnTop === null
            ? "overlay.topmostLoading"
            : alwaysOnTop
              ? "overlay.unpin"
              : "overlay.pin",
        )}
        onClick={() => void toggle()}
        variant="outlined"
      />

      {error ? (
        <span
          className="pp-overlay__topmost-error"
          role="alert"
        >
          {t("overlay.preferenceSaveFailed")}

          <button onClick={retry} type="button">
            {t("common.retry")}
          </button>
        </span>
      ) : null}
    </header>
  );
}