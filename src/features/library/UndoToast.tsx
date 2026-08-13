import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { ToastRegion } from "../../components/ToastRegion";
import type { UndoReceipt } from "./library-api";

export interface UndoToastProps {
  onDismiss: () => void;
  onUndo: (operationId: string) => void | Promise<void>;
  receipt: UndoReceipt | null;
}

export function UndoToast({ onDismiss, onUndo, receipt }: UndoToastProps) {
  const { t } = useTranslation();
  const [undoing, setUndoing] = useState(false);
  useEffect(() => {
    if (!receipt) return;
    const delay = Math.max(0, receipt.expiresAt - Date.now());
    const timer = window.setTimeout(onDismiss, delay);
    return () => window.clearTimeout(timer);
  }, [onDismiss, receipt]);

  if (!receipt) return null;
  return (
    <ToastRegion
      label={t("common.notifications")}
      toasts={[
        {
          id: receipt.operationId,
          message: t("manager.undoSaved"),
          tone: "success",
          action: (
            <Button
              disabled={undoing}
              onClick={async () => {
                setUndoing(true);
                try {
                  await onUndo(receipt.operationId);
                } finally {
                  setUndoing(false);
                }
              }}
              variant="secondary"
            >
              {t("common.undo")}
            </Button>
          ),
        },
      ]}
    />
  );
}
