import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useUI } from '../../store/ui';
import { Modal } from './Modal';

export function Toaster() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  return createPortal(
    <div className="toaster" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          {t.kind === 'success' ? <CheckCircle2 size={17} /> : t.kind === 'error' ? <AlertCircle size={17} /> : <Info size={17} />}
          <span>{t.message}</span>
          <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function ConfirmDialog() {
  const confirm = useUI((s) => s.confirm);
  const close = useUI((s) => s.closeConfirm);
  const toast = useUI((s) => s.toast);
  const [busy, setBusy] = useState(false);

  if (!confirm) return null;
  const run = async () => {
    setBusy(true);
    try {
      await confirm.onConfirm();
      close();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={() => !busy && close()} title={confirm.title} size="sm">
      <div className="modal-body">
        <p className="confirm-message">{confirm.message}</p>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button className={`btn ${confirm.danger ? 'btn-danger' : 'btn-primary'}`} onClick={run} disabled={busy} autoFocus>
          {busy ? <span className="spinner" /> : null}
          {confirm.confirmLabel ?? 'Confirm'}
        </button>
      </div>
    </Modal>
  );
}
