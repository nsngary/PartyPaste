import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import type { GameDto } from "./library-api";

export type ManagerSection = "phrases" | "variables" | "settings";
export interface GameSidebarProps {
  games: readonly GameDto[];
  onCreateGame: () => void;
  onDeleteGame: (game: GameDto) => void;
  onEditGame: (game: GameDto) => void;
  onReorderGames: (ids: string[]) => void;
  onSelectGame: (id: string) => void;
  onSelectSection: (section: ManagerSection) => void;
  section: ManagerSection;
  selectedGameId: string | null;
}

export function GameSidebar({
  games,
  onCreateGame,
  onDeleteGame,
  onEditGame,
  onReorderGames,
  onSelectGame,
  onSelectSection,
  section,
  selectedGameId,
}: GameSidebarProps) {
  const { t } = useTranslation();
  const ordered = [...games].sort((a, b) => a.sortOrder - b.sortOrder);
  function move(index: number, delta: number) {
    const to = Math.max(0, Math.min(ordered.length - 1, index + delta));
    const next = [...ordered];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    onReorderGames(next.map(({ id }) => id));
  }
  return (
    <aside className="pp-game-sidebar">
      <div className="pp-game-sidebar__brand">
        <span className="pp-brand-label">{t("app.brand")}</span>
        <span>{t("app.manager")}</span>
      </div>
      <nav aria-label={t("manager.featuresNavigation")}>
        <button
          aria-current={section === "phrases" ? "page" : undefined}
          onClick={() => onSelectSection("phrases")}
          type="button"
        >
          {t("manager.phrases")}
        </button>
        <button
          aria-current={section === "variables" ? "page" : undefined}
          onClick={() => onSelectSection("variables")}
          type="button"
        >
          {t("manager.variables")}
        </button>
        <button
          aria-current={section === "settings" ? "page" : undefined}
          onClick={() => onSelectSection("settings")}
          type="button"
        >
          {t("settings.title")}
        </button>
      </nav>
      <div className="pp-game-sidebar__heading">
        <span className="pp-brand-label">
          {t("manager.games").toUpperCase()}
        </span>
        <Button onClick={onCreateGame} variant="secondary">
          <Plus aria-hidden="true" size={14} />
          {t("manager.newGame")}
        </Button>
      </div>
      <ul className="pp-game-list">
        {ordered.map((game, index) => (
          <li
            className={game.id === selectedGameId ? "is-selected" : ""}
            key={game.id}
          >
            <button
              className="pp-game-list__select"
              onClick={() => onSelectGame(game.id)}
              type="button"
            >
              {game.name}
            </button>
            <div className="pp-game-list__actions">
              <IconButton
                disabled={index === 0}
                icon={<ChevronUp size={14} />}
                label={t("manager.moveGameUp", { name: game.name })}
                onClick={() => move(index, -1)}
              />
              <IconButton
                disabled={index === ordered.length - 1}
                icon={<ChevronDown size={14} />}
                label={t("manager.moveGameDown", { name: game.name })}
                onClick={() => move(index, 1)}
              />
              <IconButton
                icon={<Pencil size={14} />}
                label={t("manager.editGameNamed", { name: game.name })}
                onClick={() => onEditGame(game)}
              />
              <IconButton
                icon={<Trash2 size={14} />}
                label={t("manager.deleteGameNamed", { name: game.name })}
                onClick={() => onDeleteGame(game)}
              />
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
