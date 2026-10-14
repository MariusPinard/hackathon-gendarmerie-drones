import { useEffect, useId, useRef, useState } from 'react';

export function ExportDialog({ defaultName, onCancel, onConfirm }: {
  defaultName: string; onCancel: () => void; onConfirm: (filename: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [name, setName] = useState(defaultName.replace(/\.json$/i, ''));
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="confirm-dialog export-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    <form onSubmit={event => {
      event.preventDefault();
      const base = name.trim().replace(/\.json$/i, '');
      if (!base || base === '.' || base === '..') { setError('Indiquez un nom pour le fichier.'); return; }
      if (base.length > 120 || /[<>:"/\\|?*\u0000-\u001f]/.test(base) || /[. ]$/.test(base)) {
        setError('Choisissez un nom de 120 caractères maximum, sans caractères spéciaux de fichier.'); return;
      }
      onConfirm(`${base}.json`);
    }}>
      <p className="eyebrow">Mission</p><h2 id={titleId}>Exporter la mission</h2>
      <p>Choisissez le nom du fichier à télécharger.</p>
      <label>Nom du fichier<div className="export-filename"><input autoFocus value={name} maxLength={125} aria-label="Nom du fichier" aria-invalid={!!error}
        onChange={event => { setName(event.target.value); setError(''); }} /><span>.json</span></div></label>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="actions"><button type="button" onClick={onCancel}>Annuler</button><button type="submit" className="primary">Exporter le JSON</button></div>
    </form>
  </dialog>;
}
