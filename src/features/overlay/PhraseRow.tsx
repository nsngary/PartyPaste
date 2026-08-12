import type { PhraseDto } from "../library/library-api";

export interface PhraseRowProps {
  mode: "title" | "full";
  onOpen: (phrase: PhraseDto, trigger: HTMLButtonElement) => void;
  phrase: PhraseDto;
}

export function PhraseRow({ mode, onOpen, phrase }: PhraseRowProps) {
  return (
    <button
      aria-label={
        mode === "full"
          ? `${phrase.title} ${phrase.bodyTemplate}`
          : phrase.title
      }
      data-phrase-id={phrase.id}
      className="pp-phrase-row"
      onClick={(event) => onOpen(phrase, event.currentTarget)}
      type="button"
    >
      <strong>{phrase.title}</strong>
      {mode === "full" ? <span>{phrase.bodyTemplate}</span> : null}
    </button>
  );
}
