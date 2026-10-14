import { useEffect, useRef, useState } from 'react';
import { useMission } from '../app/AppContext';
import { DRONE_CATALOG } from '../data/droneCatalog';
import { generatePlan, computeCoverage } from '../engines/planning';
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
import { startMission, detectConflicts, inspectMission } from '../engines/operations';

export function ResourcesPage({ onLaunch, onBack }: { onLaunch: () => void; onBack: () => void }) {
  const { mission, setMission } = useMission();
  const [prepared, setPrepared] = useState(false), [result, setResult] = useState<PlanningResult | null>(null);
  const [panel, setPanel] = useState<string | null>('resources'), [resultOpen, setResultOpen] = useState(false), [adding, setAdding] = useState(false), [exportOpen, setExportOpen] = useState(false);
  const [fleetOpen, setFleetOpen] = useState(false), [selected, setSelected] = useState<string | null>(null), [notice, setNotice] = useState<Notice | null>(null);
  const noticeId = useRef(0), originalConstraints = useRef(JSON.stringify(mission?.constraints));
  const observedConstraints = useRef(JSON.stringify(mission?.constraints));
  const constraintKey = JSON.stringify(mission?.constraints);
  useEffect(() => { if (observedConstraints.current !== constraintKey) { observedConstraints.current = constraintKey; setPrepared(false); setResult(null); setResultOpen(false); setSelected(null); setPreserveProposal(false); setPanel('resources'); } }, [constraintKey]);
  const [preserveProposal, setPreserveProposal] = useState(mission?.status === 'planned' && !!mission.estimate && !!mission.drones.length && mission.drones.every(d => !!d.coverage.clipPolygon));
  const notify = (kind: Notice['kind'], message: string) => setNotice({ kind, message, id: ++noticeId.current });
  if (!mission) return <p className="notice">Aucune mission chargée. <button onClick={onBack}>Planifier une mission</button></p>;
  const models = mission.droneCatalog ?? DRONE_CATALOG;
  const insufficient = models.some(m => (mission.availableResources.dronesByModel[m.id] ?? 0) < (mission.estimate?.dronesByModel[m.id] ?? 0));
  const invalidate = () => { setPrepared(false); setResult(null); setResultOpen(false); setSelected(null); setPreserveProposal(false); };
  const update = (id: DroneModelId, count: number) => { if (!Number.isSafeInteger(count) || count < 0 || count > 100) return;
    setMission({ ...mission, availableResources: { dronesByModel: { ...mission.availableResources.dronesByModel, [id]: count } } }); invalidate();
  };
  const add = (model: DroneModel) => { const next = [...models, model]; validateDroneCatalog(next);
    setMission({ ...mission, droneCatalog: next, availableResources: { dronesByModel: { ...mission.availableResources.dronesByModel, [model.id]: 1 } }, estimate: mission.estimate ? { ...mission.estimate, dronesByModel: { ...mission.estimate.dronesByModel, [model.id]: 0 } } : null });
    invalidate(); setAdding(false); notify('success', `${model.name} ajouté : 1 unité disponible.`);
  };
  function calculate() { if (!mission) return; try {
    const current = { ...mission, weather: { ...mission.weather, dayNight: getDayNight(mission.location[1], mission.location[0], mission.scheduledAt) } };
    const plan = preserveProposal && originalConstraints.current === JSON.stringify(current.constraints) ? {
      missionId: current.metadata.id, estimate: current.estimate!, operationZone: current.operationZone, priorityZones: current.priorityZones, pilots: current.pilots, drones: current.drones, warnings: inspectMission(current).warnings,
    } : generatePlan(missionPlanningInput(current));
    setMission(applyPlan(current, plan)); setResult(plan); setPrepared(true); setPanel(null); setResultOpen(true); setFleetOpen(false);
    notify(plan.drones.length ? 'success' : 'warning', `${plan.drones.length} drone(s) dans le dispositif recalculé.`);
  } catch (error) { notify('error', error instanceof Error ? error.message : 'Calcul impossible.'); } }
  const metrics = result ? computeCoverage(result) : null, conflicts = prepared ? detectConflicts(mission) : [];
  return <MapWorkspace tools={[{ id: 'resources', label: 'Moyens', icon: '▤' }]} panel={panel} onPanel={next => { setPanel(next); if (window.matchMedia('(max-width: 1100px)').matches) setResultOpen(false); }} title="Ressources réelles"
    fleetOpen={fleetOpen} onFleet={() => { setResultOpen(false); setFleetOpen(open => !open); }} fleet={<FleetPanel drones={prepared ? mission.drones : []} catalog={models} selected={selected} onSelect={setSelected} onClose={() => setFleetOpen(false)} />}
    status={<><strong>{mission.metadata.name}</strong><span>02 · Ressources</span><WeatherBadge weather={mission.weather} /></>}
    rightPanel={resultOpen && metrics ? <><MetricsPanel metrics={metrics} />{result?.warnings.filter(w => !(w.startsWith('Hors période autorisée') && conflicts.some(c => c.message.startsWith('Hors période autorisée')))).map((w, i) => <p key={i} className="notice warning">{w}</p>)}{conflicts.map(c => <p className="notice error" key={c.id}>{c.message}</p>)}<div className="proposal-actions"><button onClick={() => { setPanel('resources'); setResultOpen(false); }}>Ajuster les ressources</button><button onClick={() => setExportOpen(true)}>Exporter la mission JSON</button><button className="primary" disabled={!prepared || !mission.drones.length || !!conflicts.length} onClick={() => { try { setMission(startMission(mission).mission); onLaunch(); } catch (error) { notify('error', error instanceof Error ? error.message : 'Lancement impossible.'); } }}>Lancer l’opération simulée →</button></div></> : undefined} rightPanelTitle="Dispositif recalculé" onRightPanelClose={() => setResultOpen(false)}
    floating={<><Notification notice={notice} onClose={() => setNotice(null)} />{exportOpen && <ExportDialog defaultName={mission.metadata.name} onCancel={() => setExportOpen(false)} onConfirm={filename => { try { exportMission(mission, filename); setExportOpen(false); notify('success', `Fichier ${filename} exporté.`); } catch (error) { notify('error', error instanceof Error ? error.message : 'Export impossible.'); } }} />}</>}
    panelContent={<><p className="muted">Comparez l’estimation aux moyens réellement disponibles.</p>{!mission.estimate && <p className="notice">Le premier calcul proposera les moyens utilisés.</p>}
      {models.map(model => { const count = mission.availableResources.dronesByModel[model.id] ?? 0; return <div className="resource-card" key={model.id}><h3>{model.name}</h3><p className="muted">Prévu : {mission.estimate?.dronesByModel[model.id] ?? '—'} · Disponible : {count}</p><div className="quantity-control"><button aria-label={`Réduire ${model.name}`} disabled={count === 0} onClick={() => update(model.id, count - 1)}>−</button><label><span className="sr-only">Quantité {model.name}</span><input type="number" min={0} max={100} step={1} value={count} onChange={e => update(model.id, e.currentTarget.valueAsNumber)} /></label><button aria-label={`Ajouter ${model.name}`} disabled={count === 100} onClick={() => update(model.id, count + 1)}>+</button></div><DroneSpecifications model={model} />{(model.incompatibleWithRain && mission.weather.rainDetected === true || !model.nightCapable && mission.weather.dayNight === 'night') && <p className="notice warning">Modèle exclu pour la météo ou la nuit de cette mission.</p>}</div>; })}
      {adding ? <CustomDroneForm onAdd={add} onCancel={() => setAdding(false)} /> : <button className="wide" disabled={models.length >= 20} onClick={() => setAdding(true)}>+ Ajouter un modèle de drone</button>}
      {insufficient && <p className="notice warning">Moyens inférieurs à l’estimation : couverture partielle possible.</p>}
      <button className="primary wide" disabled={adding} onClick={calculate}>Recalculer avec les ressources réelles</button>{prepared && <button className="wide" onClick={() => { setResultOpen(true); setPanel(null); setFleetOpen(false); }}>Voir le dispositif</button>}<button className="wide" onClick={onBack}>Retour à la planification</button>
    </>}>
    <MissionMap center={mission.location} operationZone={mission.operationZone} priorityZones={mission.priorityZones} drones={prepared ? mission.drones : []} pilots={prepared ? mission.pilots : []} uncoveredPoints={metrics?.uncoveredPoints ?? []} uncoveredCellSizeMeters={metrics?.sampleSpacingMeters} selected={selected} onSelect={setSelected} />
  </MapWorkspace>;
}
