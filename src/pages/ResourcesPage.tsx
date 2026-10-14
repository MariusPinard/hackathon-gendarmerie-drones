import { useRef, useState } from 'react';
import { useMission } from '../app/AppContext';
import { DRONE_CATALOG } from '../data/droneCatalog';
import { generatePlan, computeCoverage } from '../engines/planning';
import { missionPlanningInput, applyPlan } from '../services/missionPlanning';
import { exportMission } from '../services/missionStorage';
import { MissionMap } from '../components/Map/MissionMap';
import { MapWorkspace } from '../components/Layout/MapWorkspace';
import { Notification } from '../components/Controls/Notification';
import type { Notice } from '../components/Controls/Notification';
import { MetricsPanel } from '../components/Panels/MetricsPanel';
import { FleetPanel } from '../components/Panels/FleetPanel';
import { WeatherBadge } from '../components/Panels/WeatherBadge';
import type { DroneModelId } from '../types/drone';
import type { PlanningResult } from '../types/planning';
import { startMission, detectConflicts } from '../engines/operations';

export function ResourcesPage({ onLaunch, onBack }: { onLaunch: () => void; onBack: () => void }) {
  const { mission, setMission } = useMission();
  const [prepared, setPrepared] = useState(false);
  const [result, setResult] = useState<PlanningResult | null>(null);
  const [panel, setPanel] = useState<string | null>('resources');
  const [fleetOpen, setFleetOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeId = useRef(0);
  const notify = (kind: Notice['kind'], message: string) => setNotice({ kind, message, id: ++noticeId.current });
  if (!mission) return <p className="notice">Aucune mission chargée. <button onClick={onBack}>Planifier une mission</button></p>;
  const insufficient = DRONE_CATALOG.some(m => mission.availableResources.dronesByModel[m.id] < (mission.estimate?.dronesByModel[m.id] ?? 0));
  const update = (id: DroneModelId, count: number) => {
    if (!Number.isSafeInteger(count) || count < 0 || count > 100) return;
    setMission({ ...mission, availableResources: { dronesByModel: { ...mission.availableResources.dronesByModel, [id]: count } } });
    setPrepared(false); setResult(null); setSelected(null);
  };
  function calculate() { if (!mission) return; try {
    const plan = generatePlan(missionPlanningInput(mission));
    setMission(applyPlan(mission, plan)); setResult(plan); setPrepared(true); setPanel('information');
    notify('success', `Ressources recalculées : ${plan.drones.length} drones proposés.`);
  } catch (error) { notify('error', error instanceof Error ? error.message : 'Calcul impossible.'); } }
  const metrics = result ? computeCoverage(result) : null;
  const conflicts = prepared ? detectConflicts(mission) : [];
  return <MapWorkspace tools={[{ id: 'resources', label: 'Moyens', icon: '▤' }, { id: 'information', label: 'Informations', icon: 'i' }]}
    panel={panel} onPanel={setPanel} title={panel === 'resources' ? 'Ressources réelles' : 'Dispositif recalculé'}
    fleetOpen={fleetOpen} onFleet={() => setFleetOpen(open => !open)} fleet={<FleetPanel drones={prepared ? mission.drones : []} missionId={mission.metadata.id} selected={selected} onSelect={setSelected} onClose={() => setFleetOpen(false)} />}
    status={<><strong>{mission.metadata.name}</strong><span>02 · Ressources</span><WeatherBadge weather={mission.weather} /></>}
    floating={<Notification notice={notice} onClose={() => setNotice(null)} />}
    panelContent={<>
      {panel === 'resources' && <><p className="muted">Comparez l’estimation à vos moyens réellement disponibles.</p>
        {!mission.estimate && <p className="notice">Mission sans estimation : le premier calcul proposera les moyens utilisés.</p>}
        {DRONE_CATALOG.map(model => <div className="resource-card" key={model.id}><h3>{model.name}</h3><p className="muted">Prévu : {mission.estimate?.dronesByModel[model.id] ?? '—'} · Disponible : {mission.availableResources.dronesByModel[model.id]}</p>
          <div className="quantity-control"><button aria-label={`Réduire ${model.name}`} disabled={mission.availableResources.dronesByModel[model.id] === 0} onClick={() => update(model.id, mission.availableResources.dronesByModel[model.id] - 1)}>−</button>
            <label><span className="sr-only">Quantité {model.name}</span><input type="number" min={0} max={100} step={1} value={mission.availableResources.dronesByModel[model.id]} onChange={e => update(model.id, e.currentTarget.valueAsNumber)} /></label>
            <button aria-label={`Ajouter ${model.name}`} disabled={mission.availableResources.dronesByModel[model.id] === 100} onClick={() => update(model.id, mission.availableResources.dronesByModel[model.id] + 1)}>+</button></div>
          {model.incompatibleWithRain && mission.weather.rainDetected === true && <p className="notice warning">Pluie : ce modèle sera exclu du calcul.</p>}</div>)}
        {insufficient && <p className="notice warning">Ressources inférieures à l’estimation. Couverture partielle possible.</p>}
        <button className="primary wide" onClick={calculate}>Recalculer avec les ressources réelles</button><button className="wide" onClick={onBack}>Retour à la planification</button>
      </>}
      {panel === 'information' && <>{metrics ? <MetricsPanel metrics={metrics} /> : <p className="notice">Recalculez le dispositif avec vos moyens avant lancement.</p>}
        {result?.warnings.map((warning, i) => <p key={i} className="notice warning">{warning}</p>)}
        {conflicts.map(conflict => <p className="notice error" key={conflict.id}>{conflict.message}</p>)}
        <button className="wide" onClick={() => setPanel('resources')}>Ajuster les ressources</button>
        <button className="wide" onClick={() => { try { exportMission(mission); notify('success', 'Mission exportée en JSON.'); } catch (error) { notify('error', error instanceof Error ? error.message : 'Export impossible.'); } }}>Exporter la mission JSON</button>
        <button className="primary wide" disabled={!prepared || !mission.drones.length || !!conflicts.length} onClick={() => { try { setMission(startMission(mission).mission); onLaunch(); } catch (error) { notify('error', error instanceof Error ? error.message : 'Lancement impossible.'); } }}>Lancer l’opération simulée →</button>
      </>}
    </>}>
    <MissionMap center={mission.location} operationZone={mission.operationZone} priorityZones={mission.priorityZones} drones={prepared ? mission.drones : []} pilots={prepared ? mission.pilots : []} uncoveredPoints={metrics?.uncoveredPoints ?? []} selected={selected} onSelect={setSelected} />
  </MapWorkspace>;
}
