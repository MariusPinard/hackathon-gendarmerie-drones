import type { Pilot } from '../../types/drone';
import type { PilotSite } from '../../services/pilotPlacement';

const VERDICT: Record<PilotSite['verdict'], string> = {
  possible: 'Décollage possible', conditional: 'Sous conditions', impossible: 'Décollage impossible', unknown: 'Hors carte d’occupation',
};

/** Where each remote pilot takes off, from the occupancy map. Screening only, checked on site. */
export function PilotPlacementSummary({ placement, pilots, maxShift, onRetry, onReset }: {
  placement: { state: 'idle' | 'running' | 'done' | 'error'; sites: PilotSite[]; missingData: boolean; message?: string };
  pilots: Pilot[]; maxShift: number; onRetry: () => void; onReset: () => void;
}) {
  const name = (id: string) => pilots.find(p => p.id === id)?.name ?? id;
  const moved = placement.sites.filter(site => site.shiftM > 0).length;
  const unresolved = placement.sites.filter(site => site.unresolved).length;
  return <div className="pilot-placement">
    <strong>Emplacements des télépilotes</strong>
    {placement.state === 'running' && <p className="muted">Recherche des cellules de décollage sur la carte d’occupation…</p>}
    {placement.state === 'error' && <p className="notice warning">{placement.message ?? 'Placement impossible.'} Les télépilotes restent au centre des zones.</p>}
    {placement.state === 'idle' && <p className="muted">Télépilotes au centre des zones de travail.</p>}
    {placement.state === 'done' && <>
      <p className="muted">{moved} déplacé(s) vers une cellule de décollage (≤ {maxShift} m){unresolved ? ` · ${unresolved} sans cellule libre proche : à choisir sur le terrain` : ''}. Rayon réduit si besoin pour rester dans la portée.</p>
      {placement.missingData && <p className="notice warning">Carte d’occupation incomplète ici (hors Mirepoix sans calcul en direct) : certains emplacements n’ont pas pu être vérifiés.</p>}
      <ul>{placement.sites.map(site => <li key={site.pilotId} className={`takeoff-${site.verdict}`}>
        <i aria-hidden="true" /><span><b>{name(site.pilotId)}</b> · {VERDICT[site.verdict]}{site.reason ? ` (${site.reason})` : ''}
          <small>{site.shiftM ? `Déplacé de ${site.shiftM} m` : 'Au centre de la zone'}{site.radiusAfter < site.radiusBefore ? ` · rayon ${Math.round(site.radiusBefore)} → ${Math.round(site.radiusAfter)} m` : ''}</small></span>
      </li>)}</ul>
    </>}
    <div className="pilot-placement-actions">
      <button disabled={placement.state === 'running'} onClick={onRetry}>Replacer sur l’occupation</button>
      <button disabled={placement.state !== 'done'} onClick={onReset}>Remettre au centre</button>
    </div>
    <small className="muted">Aide à la décision : l’emplacement exact, l’accès et l’autorisation se vérifient sur place.</small>
  </div>;
}
