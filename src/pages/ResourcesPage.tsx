import { useState } from 'react';
import { useMission } from '../app/AppContext';
import { DRONE_CATALOG } from '../data/droneCatalog';
import { generatePlan, computeCoverage } from '../engines/planning';
import { missionPlanningInput, applyPlan } from '../services/missionPlanning';
import { exportMission } from '../services/missionStorage';
import { MissionMap } from '../components/Map/MissionMap';
import { MetricsPanel } from '../components/Panels/MetricsPanel';
import type { DroneModelId } from '../types/drone';
import type { PlanningResult } from '../types/planning';
import { startMission, detectConflicts } from '../engines/operations';

export function ResourcesPage({ onLaunch, onBack }: { onLaunch: () => void; onBack: () => void }) {
  const { mission, setMission } = useMission();
  const [prepared, setPrepared] = useState(false);
  const [result, setResult] = useState<PlanningResult | null>(null);
  const [error, setError] = useState('');
  if (!mission) return <p className="notice">Aucune mission chargée. <button onClick={onBack}>Planifier une mission</button></p>;
  const insufficient = DRONE_CATALOG.some(m => mission.availableResources.dronesByModel[m.id] < (mission.estimate?.dronesByModel[m.id] ?? 0));
  const update = (id: DroneModelId, count: number) => {
    if (!Number.isSafeInteger(count) || count < 0 || count > 100) return;
    setMission({ ...mission, availableResources: { dronesByModel: { ...mission.availableResources.dronesByModel, [id]: count } } });
    setPrepared(false); setResult(null); setError('');
  };
  function calculate() { if (!mission) return; try {
    const plan = generatePlan(missionPlanningInput(mission));
    setMission(applyPlan(mission, plan)); setResult(plan); setPrepared(true); setError('');
  } catch (err) { setError(err instanceof Error ? err.message : 'Calcul impossible.'); } }
  const metrics = result ? computeCoverage(result) : null;
  const conflicts = prepared ? detectConflicts(mission) : [];
  return <section><div className="page-title"><p className="eyebrow">02 / RESSOURCES RÉELLES</p><h1>Adapter les moyens disponibles</h1><p>{mission.metadata.name} · Une disponibilité inférieure à l’estimation autorise un calcul partiel.</p></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="workspace"><aside className="panel">
      <h2>Estimation / disponibilité</h2>
      {!mission.estimate && <p className="notice">Mission sans estimation enregistrée : le premier calcul proposera les moyens utilisés.</p>}
      {DRONE_CATALOG.map(model => <div className="resource-card" key={model.id}><h3>{model.name}</h3><p className="muted">Prévu : {mission.estimate?.dronesByModel[model.id] ?? '—'} · Disponible : {mission.availableResources.dronesByModel[model.id]}</p>
        <div className="quantity-control"><button aria-label={`Réduire ${model.name}`} disabled={mission.availableResources.dronesByModel[model.id] === 0} onClick={() => update(model.id, mission.availableResources.dronesByModel[model.id] - 1)}>−</button>
          <label><span className="sr-only">Quantité {model.name}</span><input type="number" min={0} max={100} step={1} value={mission.availableResources.dronesByModel[model.id]} onChange={e => update(model.id, e.currentTarget.valueAsNumber)} /></label>
          <button aria-label={`Ajouter ${model.name}`} disabled={mission.availableResources.dronesByModel[model.id] === 100} onClick={() => update(model.id, mission.availableResources.dronesByModel[model.id] + 1)}>+</button></div>
        {model.incompatibleWithRain && mission.weather.rainDetected === true && <p className="notice warning">Incompatible avec la pluie : exclu du calcul.</p>}</div>)}
      {insufficient && <p className="notice warning">Ressources inférieures à l’estimation. La couverture peut être partielle.</p>}
      {mission.weather.rainDetected === null && <p className="notice">Météo inconnue : aucune absence de pluie n’est supposée.</p>}
      <button className="primary wide" onClick={calculate}>Recalculer avec les ressources réelles</button>
      <div className="actions"><button onClick={onBack}>Retour à la planification</button></div>
    </aside><div className="map-column"><MissionMap center={mission.location} operationZone={mission.operationZone} priorityZones={mission.priorityZones}
      drones={prepared ? mission.drones : []} pilots={prepared ? mission.pilots : []} uncoveredPoints={metrics?.uncoveredPoints ?? []} />
      <div className="panel">{metrics ? <MetricsPanel metrics={metrics} /> : <p className="notice">Recalculez le dispositif avec vos moyens pour activer le lancement.</p>}
        {result?.warnings.map((warning, i) => <p key={i} className="notice warning">{warning}</p>)}
        {conflicts.map(conflict => <p className="notice error" key={conflict.id}>{conflict.message}</p>)}
        <div className="actions"><button onClick={() => { try { exportMission(mission); } catch (err) { setError(err instanceof Error ? err.message : 'Export impossible.'); } }}>Exporter la mission JSON</button>
          <button className="primary" disabled={!prepared || !mission.drones.length || !!conflicts.length} onClick={() => { try { setMission(startMission(mission).mission); onLaunch(); } catch (err) { setError(err instanceof Error ? err.message : 'Lancement impossible.'); } }}>Lancer l’opération simulée →</button></div>
      </div></div></div></section>;
}
