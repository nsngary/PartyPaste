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
  return (
    <Dialog
      footer={
        <>
          <Button onClick={onCancel} variant="secondary">
            Cancel
          </Button>
          <Button onClick={() => void onConfirm()} variant="danger">
            Delete
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
