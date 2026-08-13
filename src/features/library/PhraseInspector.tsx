import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { parseTemplate } from "../../domain/template";
import {
  validatePhraseBody,
  validatePhraseTitle,
} from "../../domain/validation";
import type { PhraseDto } from "./library-api";

export interface PhraseDraft {
  bodyTemplate: string;
  hotkey: string | null;
  title: string;
}

export interface PhraseInspectorProps {
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSave: (draft: PhraseDraft) => void | Promise<void>;
  phrase?: PhraseDto | null;
}

export function PhraseInspector({
  onCancel,
  onDirtyChange,
  onSave,
  phrase = null,
}: PhraseInspectorProps) {
  const { t } = useTranslation();
  const initial = {
    title: phrase?.title ?? "",
    bodyTemplate: phrase?.bodyTemplate ?? "",
    hotkey: phrase?.hotkey ?? "",
  };
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.bodyTemplate);
  const [hotkey, setHotkey] = useState(initial.hotkey);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitle(phrase?.title ?? "");
    setBody(phrase?.bodyTemplate ?? "");
    setHotkey(phrase?.hotkey ?? "");
    setError(null);
    setDiscardOpen(false);
  }, [phrase]);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const dirty =
    title !== initial.title ||
    body !== initial.bodyTemplate ||
    hotkey !== initial.hotkey;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  function cancel() {
    if (dirty) setDiscardOpen(true);
    else onCancel();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const validTitle = validatePhraseTitle(title);
    if (!validTitle.ok) {
      setError(
        validTitle.reason === "too_long"
          ? t("manager.phraseTitleTooLong")
          : t("manager.phraseTitleRequired"),
      );
      return;
    }
    const validBody = validatePhraseBody(body);
    if (!validBody.ok) {
      setError(
        validBody.reason === "too_long"
          ? t("manager.phraseBodyTooLong")
          : t("manager.phraseBodyRequired"),
      );
      return;
    }
    if (parseTemplate(validBody.value).issues.length > 0) {
      setError(t("manager.templateSyntaxError"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: validTitle.value,
        bodyTemplate: validBody.value,
        hotkey: hotkey.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <form className="pp-inspector-form" onSubmit={submit}>
        <Field label={t("manager.phraseTitle")} required>
          <input
            onChange={(event) => setTitle(event.target.value)}
            ref={titleRef}
            value={title}
          />
        </Field>
        <Field label={t("manager.phraseBody")} required>
          <textarea
            onChange={(event) => setBody(event.target.value)}
            value={body}
          />
        </Field>
        <Field
          description={t("manager.shortcutDescription")}
          label={t("manager.shortcut")}
        >
          <input
            onChange={(event) => setHotkey(event.target.value)}
            value={hotkey}
          />
        </Field>
        {error ? (
          <p className="pp-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="pp-form-actions">
          <Button onClick={cancel} variant="secondary">
            {t("common.cancel")}
          </Button>
          <Button
            loading={saving}
            loadingLabel={t("manager.savingPhrase")}
            type="submit"
          >
            {t("manager.savePhrase")}
          </Button>
        </div>
      </form>
      <Dialog
        footer={
          <>
            <Button onClick={() => setDiscardOpen(false)} variant="secondary">
              {t("manager.keepEditing")}
            </Button>
            <Button
              onClick={() => {
                setDiscardOpen(false);
                onCancel();
              }}
              variant="danger"
            >
              {t("manager.discard")}
            </Button>
          </>
        }
        onClose={() => setDiscardOpen(false)}
        open={discardOpen}
        title={t("manager.discardChanges")}
      >
        <p>{t("manager.unsavedChangesLost")}</p>
      </Dialog>
    </>
  );
}
