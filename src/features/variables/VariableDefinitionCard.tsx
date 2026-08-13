import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { VariableDefinitionWithPresets } from "../library/library-api";

export interface VariableDefinitionCardProps {
  definition: VariableDefinitionWithPresets;
  index: number;
  onDelete: () => void;
  onEdit: () => void;
  onMove: (delta: number) => void;
  total: number;
}

export function VariableDefinitionCard({
  definition: item,
  index,
  onDelete,
  onEdit,
  onMove,
  total,
}: VariableDefinitionCardProps) {
  return (
    <article className="pp-variable-card">
      <div>
        <strong>{`{${item.definition.name}}`}</strong>
        <span>{item.presets.length} common values</span>
      </div>
      <ul>
        {[...item.presets]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((preset) => (
            <li key={preset.id}>{preset.value}</li>
          ))}
      </ul>
      <div className="pp-variable-card__actions">
        <IconButton
          disabled={index === 0}
          icon={<ChevronUp size={15} />}
          label={`Move ${item.definition.name} up`}
          onClick={() => onMove(-1)}
        />
        <IconButton
          disabled={index === total - 1}
          icon={<ChevronDown size={15} />}
          label={`Move ${item.definition.name} down`}
          onClick={() => onMove(1)}
        />
        <IconButton
          icon={<Pencil size={15} />}
          label={`Edit ${item.definition.name}`}
          onClick={onEdit}
        />
        <IconButton
          icon={<Trash2 size={15} />}
          label={`Delete ${item.definition.name}`}
          onClick={onDelete}
        />
      </div>
    </article>
  );
}
