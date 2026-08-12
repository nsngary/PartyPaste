import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { GroupDto, PhraseDto } from "../library/library-api";
import { PhraseRow } from "./PhraseRow";

interface GroupView {
  group: GroupDto;
  phrases: PhraseDto[];
}

export interface PhraseListProps {
  groups: GroupView[];
  mode: "title" | "full";
  onOpenPhrase: (phrase: PhraseDto, trigger: HTMLButtonElement) => void;
  onToggleGroup: (group: GroupDto) => void;
  renderAfterPhrase?: (phrase: PhraseDto) => ReactNode;
}

export function PhraseList({
  groups,
  mode,
  onOpenPhrase,
  onToggleGroup,
  renderAfterPhrase,
}: PhraseListProps) {
  const { t } = useTranslation();
  const favorites = groups
    .flatMap(({ phrases }) => phrases)
    .filter(({ favorite }) => favorite)
    .sort((a, b) => (a.favoriteOrder ?? 0) - (b.favoriteOrder ?? 0));
  const favoriteIds = new Set(favorites.map(({ id }) => id));
  const regularCount = groups.reduce(
    (count, { phrases }) =>
      count + phrases.filter(({ id }) => !favoriteIds.has(id)).length,
    0,
  );

  if (favorites.length === 0 && regularCount === 0) {
    return <p className="pp-overlay__empty">{t("overlay.noPhrases")}</p>;
  }

  return (
    <section aria-label={t("manager.phrases")} className="pp-phrase-list">
      {favorites.length > 0 ? (
        <section className="pp-phrase-group" aria-labelledby="favorites-title">
          <h2 id="favorites-title">{t("overlay.favorites")}</h2>
          <div className="pp-phrase-group__rows">
            {favorites.map((phrase) => (
              <div className="pp-phrase-entry" key={phrase.id}>
                <PhraseRow mode={mode} onOpen={onOpenPhrase} phrase={phrase} />
                {renderAfterPhrase?.(phrase)}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {groups.map(({ group, phrases }) => {
        const regularPhrases = phrases.filter(({ id }) => !favoriteIds.has(id));
        if (regularPhrases.length === 0) return null;
        const contentId = `group-${group.id}`;
        return (
          <section className="pp-phrase-group" key={group.id}>
            <button
              aria-controls={contentId}
              aria-expanded={!group.collapsed}
              className="pp-phrase-group__toggle"
              onClick={() => onToggleGroup(group)}
              type="button"
            >
              {group.collapsed ? (
                <ChevronRight aria-hidden="true" size={15} />
              ) : (
                <ChevronDown aria-hidden="true" size={15} />
              )}
              {group.name}
            </button>
            {!group.collapsed ? (
              <div className="pp-phrase-group__rows" id={contentId}>
                {regularPhrases.map((phrase) => (
                  <div className="pp-phrase-entry" key={phrase.id}>
                    <PhraseRow
                      mode={mode}
                      onOpen={onOpenPhrase}
                      phrase={phrase}
                    />
                    {renderAfterPhrase?.(phrase)}
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </section>
  );
}
