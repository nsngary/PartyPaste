import { useTranslation } from "react-i18next";
import type { GameDto } from "../library/library-api";

export interface OverlayHeaderProps {
  games: readonly GameDto[];
  onSelectGame: (gameId: string) => void;
  selectedGameId: string;
}

export function OverlayHeader({
  games,
  onSelectGame,
  selectedGameId,
}: OverlayHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="pp-overlay__header" data-tauri-drag-region>
      <strong className="pp-brand-label" data-tauri-drag-region>
        {t("app.brand")}
      </strong>
      <label>
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
    </header>
  );
}
