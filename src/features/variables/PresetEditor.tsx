import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";

export interface EditablePreset {
  id: string;
  sortOrder: number;
  value: string;
}
export interface PresetEditorProps {
  onChange: (presets: EditablePreset[]) => void;
  presets: readonly EditablePreset[];
}

function newId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `preset-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
function reindex(presets: readonly EditablePreset[]) {
  return presets.map((preset, sortOrder) => ({ ...preset, sortOrder }));
}

export function PresetEditor({ onChange, presets }: PresetEditorProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ordered = [...presets].sort((a, b) => a.sortOrder - b.sortOrder);
  function move(index: number, delta: number) {
    const to = Math.max(0, Math.min(ordered.length - 1, index + delta));
    const next = [...ordered];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    onChange(reindex(next));
  }
  function add() {
    const normalized = value.trim().normalize("NFKC");
    if (!normalized) {
      setError(t("manager.presetRequired"));
      return;
    }
    if (Array.from(normalized).length > 200) {
      setError(t("manager.presetTooLong"));
      return;
    }
    onChange(
      reindex([
        ...ordered,
        { id: newId(), value: normalized, sortOrder: ordered.length },
      ]),
    );
    setValue("");
    setError(null);
  }
  return (
    <fieldset className="pp-preset-editor">
      <legend>{t("manager.commonValues")}</legend>
      <ul>
        {ordered.map((preset, index) => (
          <li key={preset.id}>
            <span aria-hidden="true" className="pp-preset-drag">
              <GripVertical size={14} />
            </span>
            <input
              aria-label={t("manager.presetLabel", { number: index + 1 })}
              onChange={(event) => {
                const next = [...ordered];
                next[index] = { ...preset, value: event.target.value };
                onChange(reindex(next));
              }}
              value={preset.value}
            />
            <button
              aria-label={t("manager.movePresetUp", { value: preset.value })}
              disabled={index === 0}
              onClick={() => move(index, -1)}
              type="button"
            >
              ↑
            </button>
            <button
              aria-label={t("manager.movePresetDown", { value: preset.value })}
              disabled={index === ordered.length - 1}
              onClick={() => move(index, 1)}
              type="button"
            >
              ↓
            </button>
            <IconButton
              icon={<Trash2 size={14} />}
              label={t("manager.removePreset", { value: preset.value })}
              onClick={() =>
                onChange(reindex(ordered.filter(({ id }) => id !== preset.id)))
              }
            />
          </li>
        ))}
      </ul>
      <div className="pp-preset-editor__add">
        <label>
          <span className="pp-visually-hidden">{t("manager.newPreset")}</span>
          <input
            aria-label={t("manager.newPreset")}
            onChange={(event) => setValue(event.target.value)}
            value={value}
          />
        </label>
        <Button
          leadingIcon={<Plus size={14} />}
          onClick={add}
          variant="secondary"
        >
          {t("manager.addPreset")}
        </Button>
      </div>
      {error ? (
        <p className="pp-form-error" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
