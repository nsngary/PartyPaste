import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { ToastRegion } from "../../components/ToastRegion";

export type CopyFeedbackState = "idle" | "success" | "error";

export interface CopyFeedbackProps {
  onRetry: () => void;
  state: CopyFeedbackState;
}

export function CopyFeedback({ onRetry, state }: CopyFeedbackProps) {
  const { t } = useTranslation();
  return (
    <ToastRegion
      label={t("common.notifications")}
      toasts={
        state === "success"
          ? [
              {
                id: "copy-success",
                message: t("overlay.copySuccess"),
                tone: "success",
              },
            ]
          : state === "error"
            ? [
                {
                  id: "copy-error",
                  message: t("overlay.copyFailed"),
                  tone: "error",
                  action: (
                    <Button onClick={onRetry} variant="secondary">
                      {t("common.retry")}
                    </Button>
                  ),
                },
              ]
            : []
      }
    />
  );
}
