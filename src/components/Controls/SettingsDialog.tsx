import { useEffect, useRef, useState } from 'react';
import type { DroneModel } from '../../types/drone';
import type { MissionConstraints } from '../../types/mission';
import { FrenchDateTime } from './FrenchDateTime';
import { CustomDroneForm } from './CustomDroneForm';
import { validateDroneCatalog } from '../../services/catalogValidation';

export function SettingsDialog({ catalog, constraints, onCancel, onSave }: {
  catalog: DroneModel[]; constraints: MissionConstraints; onCancel: () => void; onSave: (catalog: DroneModel[], constraints: MissionConstraints) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null), [separation, setSeparation] = useState(String(constraints.minimumVerticalSeparationMeters));
  const [overlap, setOverlap] = useState(String(constraints.maximumOverlapPercent ?? 20)), [models, setModels] = useState(catalog), [adding, setAdding] = useState(false), [error, setError] = useState('');
  const auth = constraints.authorization;
  const localTime = (iso: string) => { const d = new Date(iso); if (!Number.isFinite(d.getTime())) return ''; const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const [authorizationEnabled, setAuthorizationEnabled] = useState(!!auth), [reference, setReference] = useState(auth?.reference ?? ''), [maximum, setMaximum] = useState(String(auth?.maximumDrones ?? 1));
  const [start, setStart] = useState(auth ? localTime(auth.startAt) : ''), [end, setEnd] = useState(auth ? localTime(auth.endAt) : '');
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className="confirm-dialog settings-dialog" aria-labelledby="settings-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <div className="dialog-title"><h2 id="settings-title">Paramètres du planificateur</h2><button onClick={onCancel} aria-label="Fermer les paramètres">×</button></div>
    <p className="muted">Paramètres mémorisés sur cet appareil. Recalculez le dispositif après modification.</p>
    <label>Séparation verticale minimale (m)<input type="number" min={10} max={120} step={1} value={separation} onChange={e => setSeparation(e.target.value)} /></label>
    <label>Chevauchement maximal autorisé (%)<input type="number" min={0} max={100} step={1} value={overlap} onChange={e => setOverlap(e.target.value)} /></label>
    <p className="muted">Concerne les surfaces communes dans la zone d’opération. Une contrainte stricte peut réduire la couverture.</p>
    <details><summary>Autorisation préfectorale · facultative</summary>
      <label className="checkbox-label"><input type="checkbox" checked={authorizationEnabled} onChange={e => setAuthorizationEnabled(e.target.checked)} />Appliquer une limite d’effectif et de période</label>
      {authorizationEnabled && <><label>Référence de l’autorisation<input value={reference} maxLength={120} onChange={e => setReference(e.target.value)} /></label><label>Nombre maximal de drones<input type="number" min={0} value={maximum} onChange={e => setMaximum(e.target.value)} /></label><FrenchDateTime label="Début de période" value={start} onChange={setStart} /><FrenchDateTime label="Fin de période" value={end} onChange={setEnd} /><p className="muted">Le simulateur contrôle ces valeurs déclarées ; il ne vérifie pas la validité juridique de l’arrêté.</p></>}
    </details>
    <h3>Catalogue par défaut</h3><p className="muted">Les modèles ajoutés ici seront proposés aux nouvelles missions.</p>
    <ul className="default-models">{models.map(m => <li key={m.id}>{m.name}</li>)}</ul>
    {adding ? <CustomDroneForm onCancel={() => setAdding(false)} onAdd={model => { const next = [...models, model]; validateDroneCatalog(next); setModels(next); setAdding(false); }} /> : <button disabled={models.length >= 20} onClick={() => setAdding(true)}>+ Ajouter un drone</button>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="actions"><button onClick={onCancel}>Annuler</button><button className="primary" disabled={adding} onClick={() => { try {
      const min = Number(separation), max = Number(overlap);
      if (!separation.trim() || !overlap.trim() || !Number.isFinite(min) || min < 10 || min > 120 || !Number.isFinite(max) || max < 0 || max > 100) throw new Error('Séparation : 10–120 m. Chevauchement : 0–100 %.');
      const { authorization: _previous, ...base } = constraints;
      void _previous;
      let authorization: MissionConstraints['authorization'];
      if (authorizationEnabled) { const count = Number(maximum), first = new Date(start), last = new Date(end); if (!reference.trim() || !maximum.trim() || !Number.isSafeInteger(count) || count < 0 || !start || !end || !Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime()) || first > last) throw new Error('Complétez la référence, un effectif entier positif ou nul et une période valide.'); authorization = { reference: reference.trim(), maximumDrones: count, startAt: first.toISOString(), endAt: last.toISOString() }; }
      onSave(models, { ...base, minimumVerticalSeparationMeters: min, maximumOverlapPercent: max, ...(authorization ? { authorization } : {}) });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Paramètres invalides.'); } }}>Enregistrer les paramètres</button></div>
  </dialog>;
}
