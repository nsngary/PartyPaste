import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { DeleteConfirm } from "../library/DeleteConfirm";
import type {
  MutationResult,
  SaveVariableCommandResult,
  UndoReceipt,
  VariableDefinitionWithPresets,
} from "../library/library-api";
import { type EditablePreset, PresetEditor } from "./PresetEditor";
import { VariableDefinitionCard } from "./VariableDefinitionCard";

export interface VariableLibraryApi {
  deleteVariableDefinition(input: {
    variableDefinitionId: string;
  }): Promise<MutationResult<unknown>>;
  listVariableDefinitions(input: {
    gameId: string;
  }): Promise<VariableDefinitionWithPresets[]>;
  reorderVariableDefinitions(input: {
    gameId: string;
    orderedIds: string[];
  }): Promise<unknown>;
  reorderVariablePresets(input: {
    variableDefinitionId: string;
    orderedIds: string[];
  }): Promise<unknown>;
  saveVariableDefinition(input: {
    input: {
      id: string;
      gameId: string;
      name: string;
      sortOrder: number;
      renameConfirmed: boolean;
      presets: Array<{ id: string; value: string; sortOrder: number }>;
    };
  }): Promise<SaveVariableCommandResult>;
}

export interface VariableLibraryProps {
  api: VariableLibraryApi;
  gameId: string;
  onUndoReceipt: (receipt: UndoReceipt) => void;
}
interface EditState {
  id: string;
  name: string;
  presets: EditablePreset[];
  sortOrder: number;
}
interface RenameImpact {
  affectedPhraseCount: number;
  affectedTokenCount: number;
}
function newId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `variable-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function isControlCharacter(character: string) {
  const codePoint = character.codePointAt(0);
  return (
    codePoint !== undefined &&
    (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
  );
}

export function VariableLibrary({
  api,
  gameId,
  onUndoReceipt,
}: VariableLibraryProps) {
  const { t } = useTranslation();
  const [definitions, setDefinitions] = useState<
    VariableDefinitionWithPresets[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [renameImpact, setRenameImpact] = useState<RenameImpact | null>(null);
  const [deleting, setDeleting] =
    useState<VariableDefinitionWithPresets | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDefinitions(
        (await api.listVariableDefinitions({ gameId })).sort(
          (a, b) => a.definition.sortOrder - b.definition.sortOrder,
        ),
      );
      setError(null);
    } catch {
      setError(t("manager.variablesLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [api, gameId, t]);
  useEffect(() => {
    void load();
  }, [load]);
  async function save(renameConfirmed: boolean) {
    if (!editing) return;
    const name = editing.name.trim().normalize("NFKC");
    if (!name) {
      setError(t("manager.variableRequired"));
      return;
    }
    if (Array.from(name).length > 40) {
      setError(t("manager.variableTooLong"));
      return;
    }
    if (
      Array.from(name).some(
        (character) => character === "{" || character === "}",
      )
    ) {
      setError(t("manager.variableNoBraces"));
      return;
    }
    if (Array.from(name).some(isControlCharacter)) {
      setError(t("manager.variableNoControl"));
      return;
    }
    const invalidPreset = editing.presets.find(
      ({ value }) =>
        !value.trim() ||
        Array.from(value.trim().normalize("NFKC")).length > 200,
    );
    if (invalidPreset) {
      setError(t("manager.presetInvalid"));
      return;
    }
    try {
      const result = await api.saveVariableDefinition({
        input: {
          id: editing.id,
          gameId,
          name,
          sortOrder: editing.sortOrder,
          renameConfirmed,
          presets: editing.presets.map((preset, sortOrder) => ({
            id: preset.id,
            value: preset.value.trim().normalize("NFKC"),
            sortOrder,
          })),
        },
      });
      if (result.status === "rename_confirmation_required") {
        setRenameImpact({
          affectedPhraseCount: result.affectedPhraseCount,
          affectedTokenCount: result.affectedTokenCount,
        });
        return;
      }
      onUndoReceipt(result.undo);
      setEditing(null);
      setRenameImpact(null);
      setError(null);
      await load();
    } catch {
      setError(t("manager.variableSaveFailed"));
    }
  }
  function move(index: number, delta: number) {
    const to = Math.max(0, Math.min(definitions.length - 1, index + delta));
    const next = [...definitions];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    setDefinitions(next);
    void api.reorderVariableDefinitions({
      gameId,
      orderedIds: next.map(({ definition }) => definition.id),
    });
  }
  return (
    <section
      aria-labelledby="variables-heading"
      className="pp-variable-library"
    >
      <header>
        <div>
          <h1 id="variables-heading">{t("manager.variables")}</h1>
          <p>{t("manager.variablesDescription")}</p>
        </div>
        <Button
          onClick={() => {
            setEditing({
              id: newId(),
              name: "",
              presets: [],
              sortOrder: definitions.length,
            });
            setError(null);
          }}
        >
          {t("manager.newVariable")}
        </Button>
      </header>
      {loading ? (
        <p role="status">{t("manager.loadingVariables")}</p>
      ) : error && !editing ? (
        <p role="alert">{error}</p>
      ) : definitions.length === 0 ? (
        <p className="pp-empty">{t("manager.noVariables")}</p>
      ) : (
        <div className="pp-variable-list">
          {definitions.map((definition, index) => (
            <VariableDefinitionCard
              definition={definition}
              index={index}
              key={definition.definition.id}
              onDelete={() => setDeleting(definition)}
              onEdit={() => {
                setEditing({
                  id: definition.definition.id,
                  name: definition.definition.name,
                  presets: definition.presets.map(
                    ({ id, value, sortOrder }) => ({ id, value, sortOrder }),
                  ),
                  sortOrder: definition.definition.sortOrder,
                });
                setError(null);
              }}
              onMove={(delta) => move(index, delta)}
              total={definitions.length}
            />
          ))}
        </div>
      )}
      <Dialog
        footer={
          <>
            <Button onClick={() => setEditing(null)} variant="secondary">
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void save(false)}>
              {t("manager.saveVariable")}
            </Button>
          </>
        }
        onClose={() => setEditing(null)}
        open={editing !== null}
        title={
          editing &&
          definitions.some(({ definition }) => definition.id === editing.id)
            ? t("manager.editVariable")
            : t("manager.newVariable")
        }
      >
        {editing ? (
          <div className="pp-variable-form">
            <Field label={t("manager.variableName")} required>
              <input
                autoFocus
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
                value={editing.name}
              />
            </Field>
            <PresetEditor
              onChange={(presets) => setEditing({ ...editing, presets })}
              presets={editing.presets}
            />
            {error ? (
              <p className="pp-form-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </Dialog>
      <Dialog
        footer={
          <>
            <Button onClick={() => setRenameImpact(null)} variant="secondary">
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void save(true)}>
              {t("manager.renameVariable")}
            </Button>
          </>
        }
        onClose={() => setRenameImpact(null)}
        open={renameImpact !== null}
        title={t("manager.confirmVariableRename")}
      >
        {renameImpact ? (
          <p>
            {t("manager.renameImpact", {
              phraseCount: renameImpact.affectedPhraseCount,
              tokenCount: renameImpact.affectedTokenCount,
            })}
          </p>
        ) : null}
      </Dialog>
      <DeleteConfirm
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const result = await api.deleteVariableDefinition({
            variableDefinitionId: deleting.definition.id,
          });
          onUndoReceipt(result.undo);
          setDeleting(null);
          await load();
        }}
        open={deleting !== null}
        title={
          deleting
            ? t("manager.deleteVariableTitle", {
                name: deleting.definition.name,
              })
            : t("manager.deleteVariable")
        }
      >
        {t("manager.deleteVariableDescription")}
      </DeleteConfirm>
    </section>
  );
}
