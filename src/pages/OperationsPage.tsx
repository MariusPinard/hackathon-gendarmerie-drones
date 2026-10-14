import { useMemo, useState } from 'react';
import { useMission } from '../app/AppContext';
import { MissionMap } from '../components/Map/MissionMap';
import { MetricsPanel } from '../components/Panels/MetricsPanel';
import { DroneControls } from '../components/Controls/DroneControls';
import { ConfirmDialog } from '../components/Controls/ConfirmDialog';
import { inspectMission, recalculateMission, triggerEmergencyLanding, triggerReturnToHome, proposeLocalReorganization } from '../engines/operations';
import { exportMission } from '../services/missionStorage';
import { DRONE_CATALOG } from '../data/droneCatalog';
import type { MissionChange, OperationsResult } from '../types/operations';
import type { MissionStatus } from '../types/mission';

const labels: Record<MissionStatus, string> = { draft: 'Brouillon', planned: 'Planifiée', ready: 'Prête', active: 'Active', emergency: 'Urgence', returning: 'Retour en cours', completed: 'Terminée' };
const droneLabels = { ready: 'Prêt', active: 'Actif', unavailable: 'Indisponible', returning: 'Retour', emergency_landing: 'Atterrissage d’urgence', completed: 'Terminé' };

export function OperationsPage({ onResources }: { onResources: () => void }) {
  const { mission, setMission } = useMission();
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<'emergency' | 'return' | null>(null);
  const [error, setError] = useState('');
  const [event, setEvent] = useState('Dispositif engagé. Sélectionnez un drone ou un télépilote sur la carte.');
  const [extraWarnings, setExtraWarnings] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const result = useMemo(() => mission ? inspectMission(mission) : null, [mission]);
  if (!mission || !result) return <p className="notice">Aucune mission en conduite. <button onClick={onResources}>Préparer les ressources</button></p>;
  const active = mission.status === 'active';
  const eventMessage = mission.status === 'completed' ? 'Retour simulé terminé : chaque drone engagé a rejoint son télépilote.'
    : mission.status === 'emergency' && !mission.drones.some(d => d.status === 'emergency_landing')
      ? 'Atterrissage d’urgence simulé terminé. La mission reste en état d’urgence.' : event;
  const drone = mission.drones.find(d => `drone:${d.id}` === selected) ?? (selected?.startsWith('pilot:') ? undefined : mission.drones[0]);
  const pilot = mission.pilots.find(p => `pilot:${p.id}` === selected);
  const maxAltitude = drone ? DRONE_CATALOG.find(m => m.id === drone.modelId)?.capabilities.find(c => c.id === drone.capabilityId)?.maxAltitudeMetersAgl[mission.constraints.environment] ?? 0 : 0;
  function apply(next: OperationsResult, description: string, duration?: number) {
    setMission({ ...next.mission, metadata: { ...next.mission.metadata, updatedAt: new Date().toISOString() } });
    setEvent(description); setExtraWarnings(next.warnings); setError(''); setElapsed(duration ?? null);
  }
  function change(change: MissionChange) { if (!mission) return; try {
    const started = performance.now(), next = recalculateMission(mission, change);
    apply(next, change.type === 'move_pilot' ? `${change.pilotId} déplacé ; portée vérifiée, drones conservés.` : `${change.droneId} modifié ; couverture et conflits recalculés.`, performance.now() - started);
  } catch (err) { setError(err instanceof Error ? err.message : 'Modification impossible.'); } }
  return <section><div className="page-title operation-title"><div><p className="eyebrow">03 / CONDUITE DE L’OPÉRATION</p><h1>{mission.metadata.name}</h1><p>Déplacez les marqueurs pour simuler une évolution du terrain.</p></div><span className={`status-pill ${mission.status}`}>{labels[mission.status]}</span></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="operations-workspace"><div className="map-column"><MissionMap center={mission.location} operationZone={mission.operationZone} priorityZones={mission.priorityZones}
      drones={mission.drones} pilots={mission.pilots} uncoveredPoints={result.coverage.uncoveredPoints} selected={selected} editable={active}
      conflictDroneIds={result.conflicts.flatMap(c => c.droneIds)} onSelect={setSelected}
      onMoveDrone={(id, point) => change({ type: 'move_drone', droneId: id, dronePosition: point })}
      onMovePilot={(id, point) => change({ type: 'move_pilot', pilotId: id, pilotPosition: point })} />
      <div className="panel"><MetricsPanel metrics={result.coverage} /><p className="event-log" role="status">{eventMessage}{elapsed !== null ? ` Recalcul : ${elapsed.toFixed(0)} ms.` : ''}</p>
        {[...new Set([...result.warnings, ...extraWarnings])].map(w => <p className="notice warning" key={w}>{w}</p>)}
        <h2>Conflits {result.conflicts.length ? `(${result.conflicts.length})` : '— aucun détecté'}</h2>
        {result.conflicts.map(c => <div className="notice error" key={c.id}><strong>{c.message}</strong>{c.approximatePosition && <p>Position approximative : {c.approximatePosition[1].toFixed(5)}, {c.approximatePosition[0].toFixed(5)}</p>}</div>)}
        <p className="muted">Conflits selon les règles simplifiées du hackathon. La représentation ne prend pas en compte le relief.</p>
      </div></div><aside className="panel operation-panel"><h2>Dispositif · {mission.drones.filter(d => d.status === 'active').length} actifs</h2>
        <div className="drone-list">{mission.drones.map((d, index) => <button key={d.id} className={drone?.id === d.id ? 'selected-row' : ''} onClick={() => setSelected(`drone:${d.id}`)}><span>D{index + 1} · {d.altitudeMetersAgl.toFixed(0)} m</span><span className="muted">{droneLabels[d.status]}</span></button>)}</div>
        {drone && <DroneControls key={`${drone.id}-${drone.status}-${drone.altitudeMetersAgl}-${drone.coverage.headingDegrees}-${drone.coverage.workingAngleDegrees}`} drone={drone} maxAltitude={maxAltitude} active={active} onChange={change} />}
        {pilot && <div><h3>{pilot.name}</h3><p className="muted">Télépilote {pilot.qualification} · {pilot.pilotPosition[1].toFixed(5)}, {pilot.pilotPosition[0].toFixed(5)}</p><p className="notice">Glissez le marqueur T pour modifier uniquement sa position. La portée des drones associés sera vérifiée.</p></div>}
        <div className="operation-actions"><button disabled={!active || !mission.drones.some(d => d.status === 'unavailable')} onClick={() => { try { apply(proposeLocalReorganization(mission), 'Proposition de réorganisation locale calculée.'); } catch (err) { setError(err instanceof Error ? err.message : 'Réorganisation impossible.'); } }}>Proposer une réorganisation locale</button>
          <button className="primary" disabled={!active} onClick={() => setConfirmation('return')}>Fin de mission</button>
          <button className="danger" disabled={!['active', 'returning'].includes(mission.status)} onClick={() => setConfirmation('emergency')}>ARRÊT D’URGENCE</button>
          <button onClick={() => { try { exportMission(mission); setEvent('Mission exportée en JSON.'); } catch (err) { setError(err instanceof Error ? err.message : 'Export impossible.'); } }}>Exporter la mission JSON</button>
          <button disabled={mission.status === 'returning' || mission.drones.some(d => d.status === 'emergency_landing')} onClick={onResources}>Préparer un nouveau dispositif</button>
        </div><p className="muted">Le retour et l’atterrissage sont simulés sur 4 secondes. Les drones indisponibles sont exclus de ces mouvements.</p>
      </aside></div>
    {confirmation && <ConfirmDialog title={confirmation === 'emergency' ? 'Confirmer l’arrêt d’urgence' : 'Confirmer la fin de mission'}
      description={confirmation === 'emergency' ? 'Les drones engagés atterriront sur place dans la simulation. Aucune commande réelle ne sera envoyée.' : 'Les drones actifs retourneront vers leur télépilote dans la simulation, puis la mission sera terminée.'}
      confirmLabel={confirmation === 'emergency' ? 'Confirmer l’arrêt d’urgence' : 'Confirmer le retour'} danger={confirmation === 'emergency'} onCancel={() => setConfirmation(null)} onConfirm={() => {
        try { const next = confirmation === 'emergency' ? triggerEmergencyLanding(mission) : triggerReturnToHome(mission); apply(next, confirmation === 'emergency' ? 'Urgence : atterrissage simulé en cours.' : 'Fin de mission : retour simulé en cours.'); setConfirmation(null); }
        catch (err) { setConfirmation(null); setError(err instanceof Error ? err.message : 'Action impossible.'); }
      }} />}
  </section>;
}
