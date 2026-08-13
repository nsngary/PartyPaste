import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { GroupDto, PhraseDto } from "./library-api";
import { PhraseCard } from "./PhraseCard";

export interface GroupSectionProps {
  allGroups: readonly GroupDto[];
  group: GroupDto;
  onCreatePhrase: () => void;
  onDeleteGroup: () => void;
  onDeletePhrase: (phrase: PhraseDto) => void;
  onDuplicatePhrase: (phrase: PhraseDto) => void;
  onEditGroup: () => void;
  onEditPhrase: (phrase: PhraseDto, trigger: HTMLElement) => void;
  onMovePhrase: (phraseId: string, groupId: string, index: number) => void;
  onMoveGroup?: (delta: number) => void;
  onReorderPhrases: (ids: string[]) => void;
  onToggleFavorite: (phrase: PhraseDto) => void;
  onToggleGroup?: () => void;
  phrases: readonly PhraseDto[];
  synthetic?: boolean;
}

export function GroupSection(props: GroupSectionProps) {
  const {
    allGroups,
    group,
    onCreatePhrase,
    onDeleteGroup,
    onDeletePhrase,
    onDuplicatePhrase,
    onEditGroup,
    onEditPhrase,
    onMovePhrase,
    onMoveGroup,
    onReorderPhrases,
    onToggleFavorite,
    onToggleGroup,
    phrases,
    synthetic = false,
  } = props;
  const ordered = [...phrases].sort((a, b) => a.sortOrder - b.sortOrder);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  function reorder(id: string, delta: number) {
    const from = ordered.findIndex((phrase) => phrase.id === id);
    const to = Math.max(0, Math.min(ordered.length - 1, from + delta));
    const next = [...ordered];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onReorderPhrases(next.map((phrase) => phrase.id));
  }
  function dragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = ordered.findIndex(({ id }) => id === event.active.id);
    const to = ordered.findIndex(({ id }) => id === event.over?.id);
    const next = [...ordered];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onReorderPhrases(next.map(({ id }) => id));
  }
  return (
    <section className="pp-group" aria-labelledby={`group-${group.id}`}>
      <header className="pp-group__header">
        <button
          aria-expanded={!group.collapsed}
          className="pp-group__toggle"
          onClick={onToggleGroup}
          type="button"
        >
          {group.collapsed ? (
            <ChevronRight aria-hidden="true" size={16} />
          ) : (
            <ChevronDown aria-hidden="true" size={16} />
          )}
          <strong id={`group-${group.id}`}>{group.name}</strong>
          <span>{ordered.length}</span>
        </button>
        <div className="pp-group__actions">
          {!synthetic ? (
            <>
              <IconButton
                icon={<ChevronDown size={15} />}
                label={`Move group ${group.name} down`}
                onClick={() => onMoveGroup?.(1)}
              />
              <IconButton
                icon={<ChevronRight size={15} />}
                label={`Move group ${group.name} up`}
                onClick={() => onMoveGroup?.(-1)}
              />
              <IconButton
                icon={<Plus size={15} />}
                label={`New phrase in ${group.name}`}
                onClick={onCreatePhrase}
              />
              <IconButton
                icon={<Pencil size={15} />}
                label={`Edit group ${group.name}`}
                onClick={onEditGroup}
              />
              <IconButton
                icon={<Trash2 size={15} />}
                label={`Delete group ${group.name}`}
                onClick={onDeleteGroup}
              />
            </>
          ) : null}
        </div>
      </header>
      {!group.collapsed ? (
        ordered.length > 0 ? (
          <DndContext
            collisionDetection={closestCenter}
            onDragEnd={dragEnd}
            sensors={sensors}
          >
            <SortableContext
              items={ordered.map(({ id }) => id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="pp-phrase-list">
                {ordered.map((phrase, index) => (
                  <PhraseCard
                    allGroups={allGroups}
                    index={index}
                    key={phrase.id}
                    onDelete={() => onDeletePhrase(phrase)}
                    onDuplicate={() => onDuplicatePhrase(phrase)}
                    onEdit={(trigger) => onEditPhrase(phrase, trigger)}
                    onMove={(groupId, targetIndex) =>
                      onMovePhrase(phrase.id, groupId, targetIndex)
                    }
                    onMoveBy={(delta) => reorder(phrase.id, delta)}
                    onToggleFavorite={() => onToggleFavorite(phrase)}
                    phrase={phrase}
                    total={ordered.length}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <p className="pp-empty">No phrases in this group.</p>
        )
      ) : null}
    </section>
  );
}
