import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";

export interface PhraseFilters {
  favorites: boolean;
  shortcuts: boolean;
  templates: boolean;
}
export interface PhraseToolbarProps {
  filters: PhraseFilters;
  onChangeFilters: (filters: PhraseFilters) => void;
  onChangeSearch: (value: string) => void;
  onNewPhrase: () => void;
  search: string;
}

export function PhraseToolbar({
  filters,
  onChangeFilters,
  onChangeSearch,
  onNewPhrase,
  search,
}: PhraseToolbarProps) {
  const { t } = useTranslation();
  const filterLabels = {
    favorites: t("manager.favorites"),
    templates: t("manager.templates"),
    shortcuts: t("manager.shortcuts"),
  };
  return (
    <header className="pp-phrase-toolbar">
      <div className="pp-phrase-toolbar__top">
        <h1>{t("manager.phrases")}</h1>
        <Button leadingIcon={<Plus size={16} />} onClick={onNewPhrase}>
          {t("manager.newPhrase")}
        </Button>
      </div>
      <input
        aria-label={t("manager.searchLabel")}
        className="pp-search"
        onChange={(event) => onChangeSearch(event.target.value)}
        placeholder={t("manager.searchPlaceholder")}
        type="search"
        value={search}
      />
      <fieldset className="pp-filter-row">
        <legend className="pp-visually-hidden">{t("manager.filters")}</legend>
        {(["favorites", "templates", "shortcuts"] as const).map((key) => (
          <label key={key}>
            <input
              checked={filters[key]}
              onChange={(event) =>
                onChangeFilters({ ...filters, [key]: event.target.checked })
              }
              type="checkbox"
            />
            {filterLabels[key]}
          </label>
        ))}
      </fieldset>
    </header>
  );
}
