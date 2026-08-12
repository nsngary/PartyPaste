import { Clock3 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { RecentCopyDto } from "./copy-api";

export function RecentCopies({ recent }: { recent: readonly RecentCopyDto[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="pp-recent">
      <button
        aria-expanded={expanded}
        className="pp-recent__toggle"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <Clock3 aria-hidden="true" size={15} />
        {t("overlay.recent")}
        <span aria-hidden="true">{recent.length}</span>
      </button>
      {expanded ? (
        recent.length > 0 ? (
          <ul>
            {recent.map((item) => (
              <li key={`${item.phraseId}-${item.resolvedAt}`}>
                <strong>{item.title}</strong>
                <span>{item.resolvedText}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("overlay.noRecent")}</p>
        )
      ) : null}
    </section>
  );
}
