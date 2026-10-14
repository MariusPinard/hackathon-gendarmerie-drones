import { useEffect, useRef, useState } from 'react';
import { useMission } from '../app/AppContext';
import { MissionMap } from '../components/Map/MissionMap';
import { MapWorkspace } from '../components/Layout/MapWorkspace';
import { LocationSearch } from '../components/Controls/LocationSearch';
import { Notification } from '../components/Controls/Notification';
import type { Notice } from '../components/Controls/Notification';
import { MetricsPanel } from '../components/Panels/MetricsPanel';
import { FleetPanel } from '../components/Panels/FleetPanel';
import { WeatherBadge } from '../components/Panels/WeatherBadge';
import { FrenchDateTime } from '../components/Controls/FrenchDateTime';
import { ExportDialog } from '../components/Controls/ExportDialog';
import { PlanningDroneEditor } from '../components/Controls/PlanningDroneEditor';
import { DEFAULT_LOCATION } from '../data/defaultLocation';
import { DRONE_CATALOG } from '../data/droneCatalog';
import { estimateResources, generatePlan, computeCoverage, adjustPlanningCoverage } from '../engines/planning';
import { distanceMeters, pointInPolygon, hasCoverage } from '../engines/geometry';
import { closeDrawnPolygon } from '../engines/geometry/drawing';
import { getWeather } from '../services/weather';
import { getDayNight } from '../services/solar';
import { exportMission } from '../services/missionStorage';
import type { Coordinates, OperationZone, PriorityZone } from '../types/geo';
import type { WeatherInfo } from '../types/weather';
import type { PlanningResult, PlanningInput } from '../types/planning';
import type { Environment, DroneModel } from '../types/drone';
import type { Mission } from '../types/mission';

function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Action impossible. Réessayez.';

export function PlanningPage({ onPrepare, onSettings }: { onPrepare: () => void; onSettings: () => void }) {
  const { mission, setMission, setNavigationLocked, catalog, defaultConstraints, draftAuthorization } = useMission();
  const [name, setName] = useState(mission?.metadata.name ?? 'Nouvelle mission');
  const [center, setCenter] = useState<Coordinates>(mission?.location ?? [...DEFAULT_LOCATION]);
  const [recenterKey, setRecenterKey] = useState(0);
  const [locationLabel, setLocationLabel] = useState(mission ? 'Localisation de la mission' : 'Mirepoix');
  const [when, setWhen] = useState(localInput(new Date(mission?.scheduledAt ?? Date.now() + 3600000)));
  const [environment, setEnvironment] = useState<Environment>(mission?.constraints.environment ?? 'urban');
  const [capabilityId, setCapabilityId] = useState(mission?.constraints.capabilityId ?? 'mixed');
  const [separation, setSeparation] = useState(mission?.constraints.minimumVerticalSeparationMeters ?? defaultConstraints.minimumVerticalSeparationMeters);
  const [overlap, setOverlap] = useState(mission?.constraints.maximumOverlapPercent ?? defaultConstraints.maximumOverlapPercent ?? 20);
  const [authorization, setAuthorization] = useState(mission?.constraints.authorization ?? draftAuthorization);
  const [models, setModels] = useState<DroneModel[]>(mission?.droneCatalog ?? (mission ? structuredClone(DRONE_CATALOG) as DroneModel[] : catalog));
  const [operationZone, setOperationZone] = useState<OperationZone | null>(mission?.operationZone ?? null);
  const [priorityZones, setPriorityZones] = useState<PriorityZone[]>(mission?.priorityZones ?? []);
  const [drawing, setDrawing] = useState<'operation' | 'priority' | null>(null);
  const [vertices, setVertices] = useState<Coordinates[]>([]);
  const verticesRef = useRef<Coordinates[]>([]);
  const [weather, setWeather] = useState<WeatherInfo | null>(mission?.weather ?? null);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [result, setResult] = useState<PlanningResult | null>(() => {
    if (!mission?.estimate || !['planned', 'ready'].includes(mission.status)) return null;
    const counts = Object.fromEntries((mission.droneCatalog ?? DRONE_CATALOG).map(model => [model.id, mission.drones.filter(drone => drone.modelId === model.id && hasCoverage(drone)).length]));
    return { missionId: mission.metadata.id, estimate: { ...mission.estimate, dronesByModel: counts, pilotCount: mission.drones.filter(hasCoverage).length }, drones: mission.drones, pilots: mission.pilots, operationZone: mission.operationZone, priorityZones: mission.priorityZones, warnings: [] };
  });
  const [panel, setPanel] = useState<string | null>(null), [resultOpen, setResultOpen] = useState(false), [exportOpen, setExportOpen] = useState(false);
  const [fleetOpen, setFleetOpen] = useState(false), [selected, setSelected] = useState<string | null>(null), [notice, setNotice] = useState<Notice | null>(null);
  const noticeId = useRef(0), missionId = useRef(mission?.metadata.id ?? crypto.randomUUID()), saved = useRef(mission);
  const prefsKey = JSON.stringify({ separation: defaultConstraints.minimumVerticalSeparationMeters, overlap: defaultConstraints.maximumOverlapPercent, catalog });
  const previousPrefs = useRef(prefsKey), previousCatalog = useRef(JSON.stringify(catalog));
  const authorizationKey = JSON.stringify(draftAuthorization), previousAuthorization = useRef(authorizationKey);
  const previousWeather = useRef<WeatherInfo | null>(mission?.weather ?? null);
  const notify = (kind: Notice['kind'], text: string) => setNotice({ kind, message: text, id: ++noticeId.current });
  const invalidate = () => { setResult(null); setResultOpen(false); setMission(null); setSelected(null); };
  useEffect(() => () => setNavigationLocked(false), []);
  useEffect(() => { if (previousPrefs.current !== prefsKey) { previousPrefs.current = prefsKey; setSeparation(defaultConstraints.minimumVerticalSeparationMeters); setOverlap(defaultConstraints.maximumOverlapPercent ?? 20); if (previousCatalog.current !== JSON.stringify(catalog)) { previousCatalog.current = JSON.stringify(catalog); setModels(current => [...catalog, ...current.filter(model => !catalog.some(m => m.id === model.id))]); } invalidate(); } }, [prefsKey]);
  useEffect(() => { if (previousAuthorization.current !== authorizationKey) { previousAuthorization.current = authorizationKey; setAuthorization(draftAuthorization); invalidate(); } }, [authorizationKey]);
  useEffect(() => {
    const date = new Date(when);
    if (!when || !Number.isFinite(date.getTime()) || localInput(date) !== when) { setWeather(null); setLoadingWeather(false); return; }
    const dateTime = date.toISOString(), location: Coordinates = [...center];
    setWeather({ status: 'unavailable', location, dateTime, rainDetected: null, dayNight: getDayNight(center[1], center[0], dateTime), source: null });
    setLoadingWeather(true);
    const controller = new AbortController();
    const timer = setTimeout(() => { void getWeather(center[1], center[0], dateTime, { signal: controller.signal }).then(next => { if (!controller.signal.aborted) { if (previousWeather.current && ((previousWeather.current.rainDetected === true) !== (next.rainDetected === true) || previousWeather.current.dayNight !== next.dayNight)) invalidate(); previousWeather.current = next; setWeather(next); setLoadingWeather(false); } }); }, 600);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [when, center[0], center[1]]);
  function configuration() {
    const date = new Date(when);
    if (!when || !Number.isFinite(date.getTime()) || localInput(date) !== when) throw new Error('Complétez la date française et l’heure.');
    if (!name.trim()) throw new Error('Renseignez le nom de la mission.');
    return { location: [...center] as Coordinates, scheduledAt: date.toISOString() };
  }
  function planningInput(): PlanningInput {
    const { location, scheduledAt } = configuration();
    if (!operationZone) throw new Error('Terminez d’abord le dessin de la zone d’opération.');
    return { missionId: missionId.current, location, scheduledAt, operationZone, priorityZones,
      weather: weather ?? { status: 'unavailable', location, dateTime: scheduledAt, rainDetected: null, dayNight: getDayNight(location[1], location[0], scheduledAt), source: null },
      constraints: { environment, minimumVerticalSeparationMeters: separation, maximumOverlapPercent: overlap, defaultWorkingAngleDegrees: 360, capabilityId, ...(authorization ? { authorization } : {}) }, catalog: models, capabilityId,
      availableResources: { dronesByModel: Object.fromEntries(models.map(m => [m.id, 0])) } };
  }
  function savePlan(proposed: PlanningResult, input: PlanningInput, preserveResources = false) {
    const now = new Date().toISOString();
    const next: Mission = { schemaVersion: '1.0', metadata: { id: missionId.current, name: name.trim(), createdAt: saved.current?.metadata.createdAt ?? now, updatedAt: now }, scheduledAt: input.scheduledAt, location: input.location,
      operationZone: input.operationZone, priorityZones: input.priorityZones, weather: input.weather, constraints: input.constraints, estimate: proposed.estimate,
      availableResources: preserveResources && saved.current ? structuredClone(saved.current.availableResources) : { dronesByModel: { ...proposed.estimate.dronesByModel } }, droneCatalog: structuredClone(models), pilots: proposed.pilots, drones: proposed.drones, status: 'planned' };
    setResult(proposed); setMission(next); saved.current = next;
  }
  function startDrawing(kind: 'operation' | 'priority') {
    if (drawing) return;
    if (kind === 'priority' && !operationZone) { notify('error', 'Définissez d’abord la zone d’opération.'); return; }
    invalidate(); setPanel(null); setFleetOpen(false); setNotice(null); verticesRef.current = []; setVertices([]); setDrawing(kind); setNavigationLocked(true);
  }
  function addVertex(point: Coordinates) {
    const current = verticesRef.current;
    if (current.length >= 300) { notify('warning', '300 sommets maximum. Terminez ou annulez.'); return; }
    if (current.length && distanceMeters(current.at(-1)!, point) < 1) return;
    verticesRef.current = [...current, point]; setVertices(verticesRef.current);
  }
  function cancelDrawing() { verticesRef.current = []; setVertices([]); setDrawing(null); setNavigationLocked(false); setPanel('zones'); notify('info', 'Dessin annulé. Les zones validées sont conservées.'); }
  function finishDrawing() {
    if (!drawing) return;
    try {
      const geometry = closeDrawnPolygon(verticesRef.current);
      if (drawing === 'operation') { setOperationZone({ type: 'Feature', geometry, properties: { id: 'operation-1', name: 'Zone opération', kind: 'operation' } }); setPriorityZones(zones => zones.filter(z => z.geometry.coordinates[0]!.every(p => pointInPolygon(p, geometry)))); }
      else { if (!operationZone || !verticesRef.current.every(p => pointInPolygon(p, operationZone.geometry))) throw new Error('La priorité doit rester dans la zone d’opération.'); if (priorityZones.length >= 20) throw new Error('20 priorités maximum.'); setPriorityZones(zones => [...zones, { type: 'Feature', geometry, properties: { id: crypto.randomUUID(), name: `Priorité ${zones.length + 1}`, kind: 'priority' } }]); }
      verticesRef.current = []; setVertices([]); setDrawing(null); setNavigationLocked(false); setPanel('zones');
      notify('success', drawing === 'operation' ? 'Zone d’opération validée. Ajoutez une priorité ou calculez.' : 'Zone prioritaire validée.');
    } catch (error) { notify('error', `${message(error)} Vous pouvez continuer ou annuler le dessin.`); }
  }
  function calculate() {
    if (drawing) return;
    try { const input = planningInput(); const estimate = estimateResources(input); const proposed = generatePlan({ ...input, availableResources: { dronesByModel: estimate.dronesByModel } }); savePlan(proposed, input); setPanel(null); setResultOpen(true); setFleetOpen(false); notify(proposed.drones.length ? 'success' : 'warning', `${proposed.drones.length} drone(s) proposé(s). Consultez l’estimation à droite.`); }
    catch (error) { notify('error', message(error)); }
  }
  const metrics = result ? computeCoverage(result) : null, drone = result?.drones.find(d => `drone:${d.id}` === selected), model = models.find(m => m.id === drone?.modelId);
  const tp1 = result?.pilots.filter(p => p.qualification === 'TP1' && result.drones.some(d => d.pilotId === p.id && hasCoverage(d))).length ?? 0, tp2 = result?.pilots.filter(p => p.qualification === 'TP2' && result.drones.some(d => d.pilotId === p.id && hasCoverage(d))).length ?? 0;
  return <MapWorkspace tools={[{ id: 'configuration', label: 'Mission', icon: '⚙' }, { id: 'zones', label: 'Zones', icon: '◇' }, { id: 'settings', label: 'Paramètres', icon: '⚙' }]} panel={panel} onPanel={next => { if (next === 'settings') { onSettings(); return; } setPanel(next); if (window.matchMedia('(max-width: 1100px)').matches) setResultOpen(false); }} title={panel === 'configuration' ? 'Configuration mission' : panel === 'drone' ? 'Zone de travail du drone' : 'Zones cartographiques'} locked={!!drawing}
    fleetOpen={fleetOpen} onFleet={() => { setResultOpen(false); setFleetOpen(open => !open); }} fleet={<FleetPanel drones={result?.drones ?? []} catalog={models} selected={selected} onSelect={id => { setSelected(id); setPanel('drone'); setResultOpen(false); if (window.matchMedia('(max-width: 1100px)').matches) setFleetOpen(false); }} onClose={() => setFleetOpen(false)} />}
    rightPanel={resultOpen && result && metrics ? <><MetricsPanel metrics={metrics} /><p className="proposal-summary">{tp1} TP1 · {tp2} TP2 · séparation {separation} m</p><div className="proposal-counts">{models.map(m => <div key={m.id}><span>{m.name}</span><strong>{result.estimate.dronesByModel[m.id] ?? 0}</strong></div>)}</div>{result.warnings.map((w, i) => <p key={i} className="notice warning">{w}</p>)}<details><summary>Comprendre la proposition</summary><ul>{result.estimate.assumptions.map(a => <li key={a}>{a}</li>)}</ul></details><div className="proposal-actions"><button onClick={() => setExportOpen(true)}>Exporter la mission JSON</button><button className="primary" disabled={loadingWeather} onClick={onPrepare}>Préparer l’opération →</button></div></> : undefined} rightPanelTitle="Estimation du dispositif" onRightPanelClose={() => setResultOpen(false)}
    status={<><strong>{name}</strong><span>01 · Planification</span><WeatherBadge weather={weather} loading={loadingWeather} /></>}
    panelContent={<>
      {panel === 'configuration' && <><label>Nom de mission<input value={name} onChange={e => { setName(e.target.value); invalidate(); }} maxLength={120} /></label><p className="location-label">⌖ {locationLabel}</p><p className="muted">{center[1].toFixed(5)}, {center[0].toFixed(5)}</p><FrenchDateTime value={when} onChange={next => { setWhen(next); invalidate(); }} /><p className="muted">Heure locale : {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
        <div className="planning-weather"><WeatherBadge weather={weather} loading={loadingWeather} /><p className="muted">Prévision automatique à la date et au lieu choisis.</p>{(weather?.dayNight === 'night' || weather?.rainDetected === true) && <p className="notice warning">Nuit/pluie : seuls les modèles déclarés compatibles sont retenus ; Matrice 4T pour le catalogue standard.</p>}</div>
        <label>Environnement<select value={environment} onChange={e => { setEnvironment(e.target.value as Environment); invalidate(); }}><option value="urban">Urbain</option><option value="rural">Rural</option></select></label><label>Répartition télépilotes<select value={capabilityId} onChange={e => { setCapabilityId(e.target.value); invalidate(); }}><option value="mixed">Mix TP1 / TP2 · préférence TP1</option><option value="tp1-out-of-sight">TP1 seulement · 1 km max</option><option value="tp2-out-of-sight">TP2 seulement · 2 km max</option><option value="tp1-in-sight">TP1 en vue · 500 m max</option></select></label><p className="muted">Séparation {separation} m · chevauchement max {overlap} %. Modifiables dans Paramètres.</p><button className="primary wide" onClick={() => setPanel('zones')}>Définir les zones →</button></>}
      {panel === 'zones' && <><p className="muted">Posez les sommets, puis cliquez le premier point ou Terminer.</p><button className="wide" onClick={() => startDrawing('operation')}>Dessiner la zone d’opération</button><button className="wide" disabled={!operationZone} onClick={() => startDrawing('priority')}>Dessiner une zone prioritaire</button>{operationZone && <p className="notice success">✓ Zone validée</p>}{priorityZones.map(z => <div className="zone-row" key={z.properties.id}><span>{z.properties.name}</span><button onClick={() => { setPriorityZones(zones => zones.filter(p => p.properties.id !== z.properties.id)); invalidate(); }} aria-label={`Supprimer ${z.properties.name}`}>Supprimer</button></div>)}{operationZone && <button className="text-button" onClick={() => { setOperationZone(null); setPriorityZones([]); invalidate(); }}>Effacer toutes les zones</button>}<p className="muted">Utilisez le bouton en bas de la carte pour calculer l’estimation.</p></>}
      {panel === 'drone' && drone && model && result && <PlanningDroneEditor key={drone.id} drone={drone} model={model} maxRangeMeters={capabilityId === 'tp1-in-sight' ? 500 : capabilityId.startsWith('tp1') ? 1000 : 2000} onChange={change => { try { const input = planningInput(); const next = adjustPlanningCoverage(input, result, drone.id, change); savePlan(next, input, true); } catch (error) { notify('error', message(error)); } }} />}
    </>}
    floating={<><LocationSearch center={center} disabled={!!drawing} onError={text => notify('error', text)} onLocate={(point, label) => { if (drawing) return; if (point[0] !== center[0] || point[1] !== center[1]) invalidate(); setCenter(point); setRecenterKey(n => n + 1); setLocationLabel(label); notify('success', `Carte centrée sur ${label}.`); }} />
      {drawing ? <div className="drawing-bar" role="region" aria-label="Dessin en cours"><div><strong>{drawing === 'operation' ? 'Zone d’opération' : 'Zone prioritaire'}</strong><span>Premier point ou Terminer pour fermer</span></div><button className="primary" onClick={finishDrawing}>✓ Terminer</button><button onClick={cancelDrawing}>Annuler</button></div> : <div className="map-actionbar"><button className="primary" disabled={!operationZone || loadingWeather} onClick={calculate}>{result ? 'Recalculer l’estimation' : 'Calculer l’estimation'}</button><button disabled={!result || loadingWeather} onClick={onPrepare}>Préparer l’opération →</button>{result && <button onClick={() => { setResultOpen(true); setFleetOpen(false); }}>Voir l’estimation</button>}</div>}
      <Notification notice={notice} onClose={() => setNotice(null)} />{exportOpen && mission && <ExportDialog defaultName={mission.metadata.name} onCancel={() => setExportOpen(false)} onConfirm={filename => { try { exportMission(mission, filename); setExportOpen(false); notify('success', `Fichier ${filename} exporté.`); } catch (error) { notify('error', message(error)); } }} />}</> }>
    <MissionMap center={center} recenterKey={recenterKey} operationZone={operationZone} priorityZones={priorityZones} drawing={!!drawing} vertices={vertices} onVertex={addVertex} onFinish={finishDrawing} drones={result?.drones ?? []} pilots={result?.pilots ?? []} selected={selected} onSelect={id => { setSelected(id); if (id.startsWith('drone:')) { setPanel('drone'); setResultOpen(false); if (window.matchMedia('(max-width: 1100px)').matches) setFleetOpen(false); } }} />
  </MapWorkspace>;
}
