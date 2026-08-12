import type { PhraseDto } from "../library/library-api";

export interface PhraseRowProps {
  mode: "title" | "full";
  onOpen: (phrase: PhraseDto) => void;
  phrase: PhraseDto;
}

export function PhraseRow({ mode, onOpen, phrase }: PhraseRowProps) {
  return (
    <button
      aria-label={phrase.title}
      className="pp-phrase-row"
      onClick={() => onOpen(phrase)}
      type="button"
    >
      <strong>{phrase.title}</strong>
      {mode === "full" ? <span>{phrase.bodyTemplate}</span> : null}
    </button>
  );
}
