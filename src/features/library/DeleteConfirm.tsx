import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";

export interface DeleteConfirmProps {
  children: React.ReactNode;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  open: boolean;
  title: string;
}

export function DeleteConfirm({
  children,
  onCancel,
  onConfirm,
  open,
  title,
}: DeleteConfirmProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      footer={
        <>
          <Button onClick={onCancel} variant="secondary">
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void onConfirm()} variant="danger">
            {t("common.delete")}
          </Button>
        </>
      }
      onClose={onCancel}
      open={open}
      title={title}
    >
      <p>{children}</p>
    </Dialog>
  );
}
