import { X } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  children?: ReactNode;
};

export function ConfirmDialog({ open, title, message, onConfirm, onCancel, busy = false, children }: Props) {
  if (!open) {
    return null;
  }
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <div className="dialog dialog--closable confirmation-dialog">
        <button
          className="dialog-close-icon"
          type="button"
          disabled={busy}
          onClick={onCancel}
          aria-label="Close confirmation dialog"
          title="Close"
        >
          <X size={16} />
        </button>
        <h3>{title}</h3>
        <p>{message}</p>
        {children}
        <div className="actions">
          <button className="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy}>{busy ? "Working…" : "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

