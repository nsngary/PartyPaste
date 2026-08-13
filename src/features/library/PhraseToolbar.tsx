import { Plus } from "lucide-react";
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
  return (
    <header className="pp-phrase-toolbar">
      <div className="pp-phrase-toolbar__top">
        <h1>Phrases</h1>
        <Button leadingIcon={<Plus size={16} />} onClick={onNewPhrase}>
          New phrase
        </Button>
      </div>
      <input
        aria-label="Search phrases"
        className="pp-search"
        onChange={(event) => onChangeSearch(event.target.value)}
        placeholder="Search title, phrase, or shortcut"
        type="search"
        value={search}
      />
      <fieldset className="pp-filter-row">
        <legend className="pp-visually-hidden">Phrase filters</legend>
        {(["favorites", "templates", "shortcuts"] as const).map((key) => (
          <label key={key}>
            <input
              checked={filters[key]}
              onChange={(event) =>
                onChangeFilters({ ...filters, [key]: event.target.checked })
              }
              type="checkbox"
            />
            {key[0].toUpperCase() + key.slice(1)}
          </label>
        ))}
      </fieldset>
    </header>
  );
}
