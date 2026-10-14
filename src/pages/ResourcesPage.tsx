import { useEffect, useMemo, useRef, useState } from 'react';
import { useMission } from '../app/AppContext';
import { DRONE_CATALOG } from '../data/droneCatalog';
import { hasCoverage } from '../engines/geometry';
import { generatePlan, computeCoverage, compatibleModel } from '../engines/planning';
import { missionPlanningInput, applyPlan } from '../services/missionPlanning';
import { getDayNight } from '../services/solar';
import { exportMission } from '../services/missionStorage';
import { validateDroneCatalog } from '../services/catalogValidation';
import { MissionMap } from '../components/Map/MissionMap';
import { MapWorkspace } from '../components/Layout/MapWorkspace';
import { Notification } from '../components/Controls/Notification';
import type { Notice } from '../components/Controls/Notification';
import { ExportDialog } from '../components/Controls/ExportDialog';
import { CustomDroneForm } from '../components/Controls/CustomDroneForm';
import { DroneSpecifications } from '../components/Panels/DroneSpecifications';
import { MetricsPanel } from '../components/Panels/MetricsPanel';
import { FleetPanel } from '../components/Panels/FleetPanel';
import { WeatherBadge } from '../components/Panels/WeatherBadge';
import type { DroneModel, DroneModelId } from '../types/drone';
import type { PlanningResult } from '../types/planning';
import { DroneControls } from '../components/Controls/DroneControls';
import { retainAvailableDrones, editPreparedMission } from '../services/missionResources';
import type { MissionChange } from '../types/operations';
import { startMission, detectConflicts, inspectMission } from '../engines/operations';

export function ResourcesPage({ onLaunch, onBack }: { onLaunch: () => void; onBack: () => void }) {
  const { mission, setMission } = useMission();
  const [prepared, setPrepared] = useState(false), [result, setResult] = useState<PlanningResult | null>(null);
  const [panel, setPanel] = useState<string | null>('resources'), [resultOpen, setResultOpen] = useState(false), [adding, setAdding] = useState(false), [exportOpen, setExportOpen] = useState(false);
  const [preview, setPreview] = useState<Extract<MissionChange, { type: 'set_coverage' }> | null>(null);
  const [placingDroneId, setPlacingDroneId] = useState<string | null>(null);
  const [fleetOpen, setFleetOpen] = useState(false), [selected, setSelected] = useState<string | null>(null), [notice, setNotice] = useState<Notice | null>(null);
  const noticeId = useRef(0), originalConstraints = useRef(JSON.stringify(mission?.constraints));
  const observedConstraints = useRef(JSON.stringify(mission?.constraints));
  const constraintKey = JSON.stringify(mission?.constraints);
  useEffect(() => { if (observedConstraints.current !== constraintKey) { observedConstraints.current = constraintKey; setPrepared(false); setResult(null); setResultOpen(false); setSelected(null); setPreview(null); setPlacingDroneId(null); setPreserveProposal(false); setPanel('resources'); } }, [constraintKey]);
  const [preserveProposal, setPreserveProposal] = useState(mission?.status === 'planned' && !!mission.estimate && !!mission.drones.length && mission.drones.every(d => !!d.coverage.clipPolygon));
  const notify = (kind: Notice['kind'], message: string) => setNotice({ kind, message, id: ++noticeId.current });
  const displayedMission = useMemo(() => prepared && mission && preview ? editPreparedMission(mission, preview).mission : mission, [prepared, mission, preview]);
  if (!mission) return <p className="notice">Aucune mission chargée. <button onClick={onBack}>Planifier une mission</button></p>;
  const models = mission.droneCatalog ?? DRONE_CATALOG;
  const insufficient = models.some(m => (mission.availableResources.dronesByModel[m.id] ?? 0) < (mission.estimate?.dronesByModel[m.id] ?? 0));
  const invalidate = () => { setPrepared(false); setResult(null); setResultOpen(false); setSelected(null); setPreview(null); setPlacingDroneId(null); setPreserveProposal(false); };
  const update = (id: DroneModelId, count: number) => { if (!Number.isSafeInteger(count) || count < 0) return;
    setMission({ ...mission, availableResources: { dronesByModel: { ...mission.availableResources.dronesByModel, [id]: count } } }); invalidate();
  };
  const add = (model: DroneModel) => { const next = [...models, model]; validateDroneCatalog(next);
    setMission({ ...mission, droneCatalog: next, availableResources: { dronesByModel: { ...mission.availableResources.dronesByModel, [model.id]: 1 } }, estimate: mission.estimate ? { ...mission.estimate, dronesByModel: { ...mission.estimate.dronesByModel, [model.id]: 0 } } : null });
    invalidate(); setAdding(false); notify('success', `${model.name} ajouté : 1 unité disponible.`);
  };
  function calculate() { if (!mission) return; try {
    const current = { ...mission, weather: { ...mission.weather, dayNight: getDayNight(mission.location[1], mission.location[0], mission.scheduledAt) } };
    const plan = preserveProposal && originalConstraints.current === JSON.stringify(current.constraints) && current.drones.filter(hasCoverage).every(drone => { const model = models.find(item => item.id === drone.modelId); return model && compatibleModel(model, current.weather); }) ? {
      missionId: current.metadata.id, estimate: current.estimate!, operationZone: current.operationZone, priorityZones: current.priorityZones, pilots: current.pilots, drones: current.drones, warnings: inspectMission(current).warnings,
    } : generatePlan(missionPlanningInput(current));
    const next = retainAvailableDrones(applyPlan(current, plan));
    setMission(next); setResult({ ...plan, drones: next.drones, pilots: next.pilots }); setPrepared(true); setPreview(null); setPanel(null); setResultOpen(true); setFleetOpen(false);
    notify(plan.drones.length ? 'success' : 'warning', `${plan.drones.filter(hasCoverage).length} drone(s) prévus · ${next.drones.filter(d => d.status === 'reserve').length} en réserve.`);
  } catch (error) { notify('error', error instanceof Error ? error.message : 'Calcul impossible.'); } }
  function select(id: string) { setPreview(null); setSelected(id); setPanel('drone'); setResultOpen(false); setPlacingDroneId(null); if (window.matchMedia('(max-width: 1100px)').matches) setFleetOpen(false); }
  function edit(change: MissionChange) { if (!mission || !result) return; try {
    const next = editPreparedMission(mission, change);
    setMission(next.mission); setResult({ ...result, drones: next.mission.drones, pilots: next.mission.pilots }); setPlacingDroneId(null); setPreview(null);
    notify(next.conflicts.length ? 'warning' : 'success', next.conflicts.length ? 'Drone modifié. Résolvez les conflits avant lancement.' : 'Drone modifié ; couverture recalculée.');
  } catch (error) { notify('error', error instanceof Error ? error.message : 'Modification impossible.'); } }
  const drone = mission.drones.find(d => `drone:${d.id}` === selected);
  const maxAltitude = models.find(m => m.id === drone?.modelId)?.capabilities.find(c => c.id === drone?.capabilityId)?.maxAltitudeMetersAgl[mission.constraints.environment] ?? 0;
  const metrics = result && displayedMission ? computeCoverage({ ...result, drones: displayedMission.drones }) : null, conflicts = prepared && displayedMission ? detectConflicts(displayedMission) : [];
  return <MapWorkspace tools={[{ id: 'resources', label: 'Moyens', icon: '▤' }, { id: 'catalog', label: 'Drone', icon: '▦' }, { id: 'dispositif', label: 'Dispositif', icon: '◉', disabled: !prepared, active: resultOpen, onActivate: () => { setPreview(null); setResultOpen(open => !open); setPanel(null); setFleetOpen(false); } }, { id: 'export', label: 'Export JSON', icon: '↥', onActivate: () => setExportOpen(true) }]} panel={panel} onPanel={next => { if (next !== 'drone') setPreview(null); setPanel(next); if (window.matchMedia('(max-width: 1100px)').matches) setResultOpen(false); }} title={panel === 'catalog' ? 'Modèles de drones enregistrés' : panel === 'drone' ? 'Drone supplémentaire / réglages' : 'Ressources réelles'}
    fleetOpen={fleetOpen} onFleet={() => { setPreview(null); setResultOpen(false); setFleetOpen(open => !open); }} fleet={<FleetPanel drones={prepared ? displayedMission?.drones ?? [] : []} catalog={models} selected={selected} onSelect={select} onClose={() => setFleetOpen(false)} />}
    status={<><strong>{mission.metadata.name}</strong><span>02 · Ressources</span><WeatherBadge weather={mission.weather} /></>}
    rightPanel={resultOpen && metrics ? <><MetricsPanel metrics={metrics} />{result?.warnings.filter(w => !(w.startsWith('Hors période autorisée') && conflicts.some(c => c.message.startsWith('Hors période autorisée')))).map((w, i) => <p key={i} className="notice warning">{w}</p>)}{conflicts.map(c => <p className="notice error" key={c.id}>{c.message}</p>)}<div className="proposal-actions"><button onClick={() => { setPanel('resources'); setResultOpen(false); }}>Ajuster les ressources</button><button onClick={() => setExportOpen(true)}>Exporter la mission JSON</button><button className="primary" disabled={!prepared || !mission.drones.some(drone => drone.status === 'ready') || !!conflicts.length} onClick={() => { try { setMission(startMission(mission).mission); onLaunch(); } catch (error) { notify('error', error instanceof Error ? error.message : 'Lancement impossible.'); } }}>Lancer l’opération simulée →</button></div></> : undefined} rightPanelTitle="Dispositif recalculé" onRightPanelClose={() => setResultOpen(false)}
    floating={<>{placingDroneId && <div className="drawing-bar" role="status"><div><strong>Placer {placingDroneId}</strong><span>Cliquez sa nouvelle position sur la carte.</span></div><button onClick={() => setPlacingDroneId(null)}>Annuler</button></div>}<Notification notice={notice} onClose={() => setNotice(null)} />{exportOpen && <ExportDialog defaultName={mission.metadata.name} onCancel={() => setExportOpen(false)} onConfirm={filename => { try { exportMission(mission, filename); setExportOpen(false); notify('success', `Fichier ${filename} exporté.`); } catch (error) { notify('error', error instanceof Error ? error.message : 'Export impossible.'); } }} />}</>}
    panelContent={<>{panel === 'catalog' ? <><p className="muted">Catalogue de cette mission · {models.length} modèle(s) enregistré(s).</p><p className="notice">Caractéristiques déclarées. La règle de mission reste : Matrice 4T uniquement la nuit ou sous la pluie.</p>{models.map(model => <article className="resource-card" key={model.id}><h3>{model.name}</h3><div className="drone-specifications"><dl>
      <div><dt>Vol de nuit</dt><dd>{model.nightCapable ? 'Oui' : 'Non'}</dd></div>
      <div><dt>Vol sous la pluie</dt><dd>{model.incompatibleWithRain ? 'Non' : 'Oui'}</dd></div>
      <div><dt>Résistance au vent</dt><dd>{model.windResistanceMetersPerSecond === undefined ? 'Non renseignée' : `${model.windResistanceMetersPerSecond.toLocaleString('fr-FR')} m/s`}</dd></div>
      <div><dt>Zoom</dt><dd>{model.zoom ?? 'Non renseigné'}</dd></div>
    </dl></div></article>)}</> : panel === 'drone' && drone ? <><p className="notice">Les drones en réserve peuvent être placés puis engagés. Leur couverture compte après engagement.</p><DroneControls drone={drone} maxAltitude={maxAltitude} modelName={models.find(m => m.id === drone.modelId)?.name ?? drone.modelId} separation={mission.constraints.minimumVerticalSeparationMeters} active={prepared} onChange={edit} onPreview={setPreview} onPlace={() => { setPreview(null); setPlacingDroneId(drone.id); setPanel(null); setFleetOpen(false); setResultOpen(false); }} /></> : <><p className="muted">Comparez l’estimation aux moyens réellement disponibles.</p>{!mission.estimate && <p className="notice">Le premier calcul proposera les moyens utilisés.</p>}
      {models.map(model => { const count = mission.availableResources.dronesByModel[model.id] ?? 0; return <div className="resource-card" key={model.id}><h3>{model.name}</h3><p className="muted">Prévu : {mission.estimate?.dronesByModel[model.id] ?? '—'} · Disponible : {count}</p><div className="quantity-control"><button aria-label={`Réduire ${model.name}`} disabled={count === 0} onClick={() => update(model.id, count - 1)}>−</button><label><span className="sr-only">Quantité {model.name}</span><input type="number" min={0} step={1} value={count} onChange={e => update(model.id, e.currentTarget.valueAsNumber)} /></label><button aria-label={`Ajouter ${model.name}`} onClick={() => update(model.id, count + 1)}>+</button></div><DroneSpecifications model={model} />{!compatibleModel(model, mission.weather) && <p className="notice warning">Modèle exclu pour la météo ou la nuit de cette mission.</p>}</div>; })}
      {adding ? <CustomDroneForm onAdd={add} onCancel={() => setAdding(false)} /> : <button className="wide" disabled={models.length >= 20} onClick={() => setAdding(true)}>+ Ajouter un modèle de drone</button>}
      {insufficient && <p className="notice warning">Moyens inférieurs à l’estimation : couverture partielle possible.</p>}
      <button className="primary wide" disabled={adding} onClick={calculate}>Recalculer avec les ressources réelles</button><button className="wide" onClick={onBack}>Retour à la planification</button>
    </>}</>}>
    <MissionMap center={mission.location} operationZone={mission.operationZone} priorityZones={mission.priorityZones} uncoveredPoints={metrics?.uncoveredPoints ?? []} drones={prepared ? displayedMission?.drones ?? [] : []} pilots={prepared ? mission.pilots : []} selected={selected} onSelect={select} editable={prepared} placingDroneId={placingDroneId}
      conflictDroneIds={conflicts.flatMap(conflict => conflict.droneIds)} onMoveDrone={(id, point) => edit({ type: 'move_drone', droneId: id, dronePosition: point })} onMovePilot={(id, point) => edit({ type: 'move_pilot', pilotId: id, pilotPosition: point })} />
  </MapWorkspace>;
}
