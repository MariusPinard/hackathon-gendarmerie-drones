import { useMemo, useRef, useState } from 'react';
import { useMission } from '../app/AppContext';
import { MissionMap } from '../components/Map/MissionMap';
import { MapWorkspace } from '../components/Layout/MapWorkspace';
import { MetricsPanel } from '../components/Panels/MetricsPanel';
import { FleetPanel } from '../components/Panels/FleetPanel';
import { WeatherBadge } from '../components/Panels/WeatherBadge';
import { DroneControls } from '../components/Controls/DroneControls';
import { ExportDialog } from '../components/Controls/ExportDialog';
import { ConfirmDialog } from '../components/Controls/ConfirmDialog';
import { Notification } from '../components/Controls/Notification';
import type { Notice } from '../components/Controls/Notification';
import { inspectMission, recalculateMission, restartOperation, triggerEmergencyLanding, triggerReturnToHome, proposeLocalReorganization } from '../engines/operations';
import { exportMission } from '../services/missionStorage';
import { DRONE_CATALOG } from '../data/droneCatalog';
import type { MissionChange, OperationsResult } from '../types/operations';
import type { MissionStatus } from '../types/mission';

const labels: Record<MissionStatus, string> = { draft: 'Brouillon', planned: 'Planifiée', ready: 'Prête', active: 'Active', emergency: 'Urgence', returning: 'Retour en cours', completed: 'Terminée' };
type CoverageChange = Extract<MissionChange, { type: 'set_coverage' }>;

export function OperationsPage({ onResources }: { onResources: () => void }) {
  const { mission, setMission } = useMission();
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<string | null>(null);
  const [fleetOpen, setFleetOpen] = useState(true);
  const [preview, setPreview] = useState<CoverageChange | null>(null);
  const [placingDroneId, setPlacingDroneId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<'emergency' | 'return' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeId = useRef(0);
  const notify = (kind: Notice['kind'], message: string) => setNotice({ kind, message, id: ++noticeId.current });
  const [event, setEvent] = useState('Dispositif engagé. Sélectionnez un drone ou un télépilote sur la carte.');
  const [extraWarnings, setExtraWarnings] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const canPreview = preview && mission?.status === 'active' && mission.drones.some(d => d.id === preview.droneId && ['active', 'reserve'].includes(d.status));
  const result = useMemo(() => mission ? canPreview && preview ? recalculateMission(mission, preview) : inspectMission(mission) : null, [mission, preview, canPreview]);
  if (!mission || !result) return <p className="notice">Aucune mission en conduite. <button onClick={onResources}>Préparer les ressources</button></p>;
  const catalog = mission.droneCatalog ?? DRONE_CATALOG;
  const active = mission.status === 'active';
  const drone = mission.drones.find(d => `drone:${d.id}` === selected);
  const pilot = mission.pilots.find(p => `pilot:${p.id}` === selected);
  const maxAltitude = drone ? catalog.find(m => m.id === drone.modelId)?.capabilities.find(c => c.id === drone.capabilityId)?.maxAltitudeMetersAgl[mission.constraints.environment] ?? 0 : 0;
  const eventMessage = mission.status === 'completed' ? 'Retour simulé terminé : chaque drone engagé a rejoint son télépilote.'
    : mission.status === 'emergency' && !mission.drones.some(d => d.status === 'emergency_landing') ? 'Atterrissage d’urgence simulé terminé. Vous pouvez relancer l’opération.' : event;
  function select(id: string) { setSelected(id); setPreview(null); setPlacingDroneId(null); setPanel('drone'); if (window.matchMedia('(max-width: 1100px)').matches) setFleetOpen(false); }
  function apply(next: OperationsResult, description: string, duration?: number) {
    setMission({ ...next.mission, metadata: { ...next.mission.metadata, updatedAt: new Date().toISOString() } });
    setEvent(description); setExtraWarnings(next.warnings); setElapsed(duration ?? null); setPreview(null); setPlacingDroneId(null);
    notify('success', description);
  }
  function change(change: MissionChange) { if (!mission) return; try {
    const started = performance.now(), next = recalculateMission(mission, change);
    apply(next, change.type === 'move_pilot' ? `${change.pilotId} déplacé ; drones conservés.` : `${change.droneId} modifié ; couverture et conflits recalculés.`, performance.now() - started);
  } catch (error) { notify('error', error instanceof Error ? error.message : 'Modification impossible.'); } }
  const titles: Record<string, string> = { drone: 'Drone / télépilote', information: 'Informations & couverture', actions: 'Conduite & actions' };
  return <MapWorkspace tools={[{ id: 'drone', label: 'Réglages', icon: '⌖' }, { id: 'information', label: 'Couverture', icon: 'i' }, { id: 'actions', label: 'Actions', icon: '⚑' }]}
    panel={panel} onPanel={next => { setPanel(next); if (next !== 'drone') setPreview(null); }} title={titles[panel ?? ''] ?? ''}
    fleetOpen={fleetOpen} onFleet={() => { setFleetOpen(open => !open); if (window.matchMedia('(max-width: 1100px)').matches) { setPanel(null); setPreview(null); } }}
    fleet={<FleetPanel drones={mission.drones} catalog={catalog} selected={selected} onSelect={select} onClose={() => setFleetOpen(false)} />}
    status={<><strong>{mission.metadata.name}</strong><span className={`status-pill ${mission.status}`}>{labels[mission.status]}</span><WeatherBadge weather={mission.weather} />{canPreview && <span className="preview-badge">Aperçu du secteur</span>}{result.conflicts.length > 0 && <button className="conflict-badge" onClick={() => setPanel('information')}>{result.conflicts.length} conflit(s)</button>}</>}
    panelContent={<>
      {panel === 'drone' && <>{drone ? <DroneControls key={`${drone.id}-${drone.status}`} drone={drone} modelName={catalog.find(m => m.id === drone.modelId)?.name ?? drone.modelId} separation={mission.constraints.minimumVerticalSeparationMeters} maxAltitude={maxAltitude} active={active} onChange={change} onPreview={setPreview} onPlace={() => { setPreview(null); setPlacingDroneId(drone.id); setPanel(null); setFleetOpen(false); }} />
        : pilot ? <><h3>{pilot.name}</h3><p className="muted">Télépilote {pilot.qualification} · {pilot.pilotPosition[1].toFixed(5)}, {pilot.pilotPosition[0].toFixed(5)}</p><p className="notice">Glissez le marqueur T pour déplacer uniquement le télépilote. La portée sera recalculée.</p></>
        : <><p className="notice">Cliquez un marqueur D ou T sur la carte, ou choisissez un drone dans la flotte.</p><button onClick={() => setFleetOpen(true)}>Afficher la flotte</button></>}
      </>}
      {panel === 'information' && <><MetricsPanel metrics={result.coverage} />{canPreview && <p className="notice">Métriques de l’aperçu. Validez le cap et l’angle pour sauvegarder.</p>}
        <p className="event-log" role="status">{eventMessage}{elapsed !== null ? ` Recalcul : ${elapsed.toFixed(0)} ms.` : ''}</p>
        {[...new Set([...result.warnings, ...extraWarnings])].map(w => <p className="notice warning" key={w}>{w}</p>)}
        <h3>Conflits {result.conflicts.length ? `(${result.conflicts.length})` : '— aucun détecté'}</h3>
        {result.conflicts.map(c => <div className="notice error" key={c.id}><strong>{c.message}</strong>{c.approximatePosition && <p>Position : {c.approximatePosition[1].toFixed(5)}, {c.approximatePosition[0].toFixed(5)}</p>}</div>)}
        <p className="muted">Règles simplifiées du hackathon, sans relief ni commande réelle.</p></>}
      {panel === 'actions' && <><p className="notice">{mission.drones.filter(d => d.status === 'active').length} drones actifs · {labels[mission.status]}</p>
        <button className="wide" disabled={!active || !mission.drones.some(d => d.status === 'unavailable')} onClick={() => { try { apply(proposeLocalReorganization(mission), 'Réorganisation locale calculée.'); } catch (error) { notify('error', error instanceof Error ? error.message : 'Réorganisation impossible.'); } }}>Proposer une réorganisation locale</button>
        <button className="primary wide" disabled={!active} onClick={() => setConfirmation('return')}>Fin de mission</button>
        {mission.status === 'emergency' ? <button className="primary wide" disabled={mission.drones.some(d => d.status === 'emergency_landing')} onClick={() => { try { apply(restartOperation(mission), 'Opération relancée : dispositif restauré.'); } catch (error) { notify('error', error instanceof Error ? error.message : 'Relance impossible.'); } }}>Relancer l’opération</button> : <button className="danger wide" disabled={!['active', 'returning'].includes(mission.status)} onClick={() => setConfirmation('emergency')}>ARRÊT D’URGENCE</button>}
        <button className="wide" onClick={() => setExportOpen(true)}>Exporter la mission JSON</button>
        <button className="wide" disabled={mission.status === 'returning' || mission.drones.some(d => d.status === 'emergency_landing')} onClick={onResources}>Préparer un nouveau dispositif</button>
        <p className="muted">Retour/atterrissage simulés en 4 s. Les drones indisponibles restent immobiles.</p></>}
    </>}
    floating={<>{placingDroneId && active && <div className="drawing-bar" role="status"><div><strong>Déplacer {placingDroneId}</strong><span>Cliquez sa nouvelle position sur la carte.</span></div><button onClick={() => setPlacingDroneId(null)}>Annuler</button></div>}
      <Notification notice={notice} onClose={() => setNotice(null)} />
      {exportOpen && <ExportDialog defaultName={mission.metadata.name} onCancel={() => setExportOpen(false)} onConfirm={filename => { try { exportMission(mission, filename); setExportOpen(false); notify('success', `Fichier ${filename} exporté.`); } catch (error) { notify('error', error instanceof Error ? error.message : 'Export impossible.'); } }} />}
      {confirmation && <ConfirmDialog title={confirmation === 'emergency' ? 'Confirmer l’arrêt d’urgence' : 'Confirmer la fin de mission'}
        description={confirmation === 'emergency' ? 'Les drones engagés atterriront sur place dans la simulation. Aucune commande réelle.' : 'Les drones actifs retourneront vers leur télépilote, puis la mission sera terminée.'}
        confirmLabel={confirmation === 'emergency' ? 'Confirmer l’arrêt d’urgence' : 'Confirmer le retour'} danger={confirmation === 'emergency'} onCancel={() => setConfirmation(null)} onConfirm={() => {
          try { apply(confirmation === 'emergency' ? triggerEmergencyLanding(mission) : triggerReturnToHome(mission), confirmation === 'emergency' ? 'Urgence : atterrissage simulé en cours.' : 'Fin de mission : retour simulé en cours.'); setConfirmation(null); }
          catch (error) { setConfirmation(null); notify('error', error instanceof Error ? error.message : 'Action impossible.'); }
        }} />}
    </>}>
    <MissionMap center={mission.location} operationZone={mission.operationZone} priorityZones={mission.priorityZones} drones={result.mission.drones} pilots={mission.pilots}
      selected={selected} editable={active} placingDroneId={active ? placingDroneId : null}
      conflictDroneIds={result.conflicts.flatMap(c => c.droneIds)} onSelect={select}
      onMoveDrone={(id, point) => change({ type: 'move_drone', droneId: id, dronePosition: point })}
      onMovePilot={(id, point) => change({ type: 'move_pilot', pilotId: id, pilotPosition: point })} />
  </MapWorkspace>;
}
