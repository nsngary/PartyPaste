import { AppWindow, Pin, PinOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWindowSettings } from "../../api/useWindowSettings";
import type { WindowSettingsApi } from "../../api/window-settings";
import { IconButton } from "../../components/IconButton";
import type { GameDto } from "../library/library-api";
import {
  type OverlayOpacityApi,
  useOverlayOpacity,
} from "./overlay-opacity";

import { getCurrentWindow } from "@tauri-apps/api/window";

export type OverlayTopmostApi = WindowSettingsApi;

export interface OverlayHeaderProps {
  games: readonly GameDto[];
  onSelectGame: (gameId: string) => void;
  opacityApi: OverlayOpacityApi;
  selectedGameId: string;
  topmostApi: OverlayTopmostApi;
}

export function OverlayHeader({
  games,
  onSelectGame,
  opacityApi,
  selectedGameId,
  topmostApi,
}: OverlayHeaderProps) {
  const { t } = useTranslation();

  const {
    alwaysOnTop,
    error: topmostError,
    pending,
    retry: retryTopmost,
    toggle: toggleTopmost,
  } = useWindowSettings(topmostApi);

  const {
    autoFadeEnabled,
    error: opacityError,
    idle,
    manualOpacityPercent,
    retry: retryOpacity,
    setAutoFadeEnabled,
    setManualOpacityPercent,
  } = useOverlayOpacity(opacityApi);

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
        onClick={() => void toggleTopmost()}
        variant="outlined"
      />

      <div className="pp-overlay__opacity-controls">
        <label className="pp-overlay__opacity-slider">
          <span>
            {t("overlay.opacity", {
              value: manualOpacityPercent,
            })}
          </span>

          <input
            aria-valuetext={`${manualOpacityPercent}%`}
            max="100"
            min="40"
            onChange={(event) =>
              setManualOpacityPercent(
                Number(event.target.value),
              )
            }
            step="1"
            type="range"
            value={manualOpacityPercent}
          />
        </label>

        <label className="pp-overlay__auto-fade">
          <input
            checked={autoFadeEnabled}
            onChange={(event) =>
              setAutoFadeEnabled(event.target.checked)
            }
            type="checkbox"
          />

          <span>{t("overlay.autoFade")}</span>
        </label>

        {autoFadeEnabled ? (
          <span
            aria-live="polite"
            className="pp-overlay__opacity-status"
          >
            {t(
              idle
                ? "overlay.opacityIdle"
                : "overlay.opacityActive",
            )}
          </span>
        ) : null}
      </div>

      {topmostError ? (
        <span
          className="pp-overlay__setting-error"
          role="alert"
        >
          {t("overlay.preferenceSaveFailed")}

          <button onClick={retryTopmost} type="button">
            {t("common.retry")}
          </button>
        </span>
      ) : null}

      {opacityError ? (
        <span
          className="pp-overlay__setting-error"
          role="alert"
        >
          {t("overlay.opacityFailed")}

          <button onClick={retryOpacity} type="button">
            {t("common.retry")}
          </button>
        </span>
      ) : null}
    </header>
  );
}