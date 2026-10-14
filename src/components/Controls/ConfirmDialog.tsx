import { useEffect, useRef } from 'react';

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onCancel, danger = false }: {
  title: string; description: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; danger?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="confirm-dialog" aria-labelledby="confirmation-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id="confirmation-title">{title}</h2><p>{description}</p><div className="actions"><button autoFocus onClick={onCancel}>Annuler</button><button className={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</button></div>
  </dialog>;
}
