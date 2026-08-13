import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, GripVertical, Pencil, Star, Trash2 } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { GroupDto, PhraseDto } from "./library-api";

export interface PhraseCardProps {
  allGroups: readonly GroupDto[];
  index: number;
  onDelete: () => void;
  onDuplicate: () => void;
  onEdit: (trigger: HTMLElement) => void;
  onMove: (groupId: string, index: number) => void;
  onMoveBy: (delta: number) => void;
  onToggleFavorite: () => void;
  phrase: PhraseDto;
  total: number;
}

export function PhraseCard({
  allGroups,
  index,
  onDelete,
  onDuplicate,
  onEdit,
  onMove,
  onMoveBy,
  onToggleFavorite,
  phrase,
  total,
}: PhraseCardProps) {
  const sortable = useSortable({ id: phrase.id });
  return (
    <article
      className="pp-phrase-card"
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
    >
      <button
        aria-label={`Drag ${phrase.title}`}
        className="pp-drag-handle"
        ref={sortable.setActivatorNodeRef}
        type="button"
        {...sortable.attributes}
        {...sortable.listeners}
      >
        <GripVertical aria-hidden="true" size={16} />
      </button>
      <button
        className="pp-phrase-card__main"
        onClick={(event) => onEdit(event.currentTarget)}
        type="button"
      >
        <strong>{phrase.title}</strong>
        <span>{phrase.bodyTemplate}</span>
        {phrase.hotkey ? <kbd>{phrase.hotkey}</kbd> : null}
      </button>
      <div className="pp-phrase-card__actions">
        <IconButton
          icon={<Pencil size={15} />}
          label={`Edit ${phrase.title}`}
          onClick={(event) => onEdit(event.currentTarget)}
        />
        <IconButton
          icon={<Copy size={15} />}
          label={`Duplicate ${phrase.title}`}
          onClick={onDuplicate}
        />
        <IconButton
          icon={
            <Star fill={phrase.favorite ? "currentColor" : "none"} size={15} />
          }
          label={`${phrase.favorite ? "Remove" : "Add"} ${phrase.title} ${phrase.favorite ? "from" : "to"} favorites`}
          onClick={onToggleFavorite}
        />
        <IconButton
          icon={<Trash2 size={15} />}
          label={`Delete ${phrase.title}`}
          onClick={onDelete}
        />
      </div>
      <div className="pp-move-controls">
        <button
          aria-label={`Move ${phrase.title} up`}
          className="pp-move-control"
          disabled={index === 0}
          onClick={() => onMoveBy(-1)}
          type="button"
        >
          ↑
        </button>
        <button
          aria-label={`Move ${phrase.title} down`}
          className="pp-move-control"
          disabled={index === total - 1}
          onClick={() => onMoveBy(1)}
          type="button"
        >
          ↓
        </button>
        <label>
          <span className="pp-visually-hidden">{`Move ${phrase.title} to group`}</span>
          <select
            aria-label={`Move ${phrase.title} to group`}
            className="pp-move-select"
            onChange={(event) => {
              if (event.target.value !== phrase.groupId)
                onMove(event.target.value, 0);
            }}
            value={phrase.groupId}
          >
            {allGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </article>
  );
}
