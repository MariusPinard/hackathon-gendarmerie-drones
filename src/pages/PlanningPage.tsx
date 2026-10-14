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
import { DRONE_CATALOG } from '../data/droneCatalog';
import { DEFAULT_LOCATION } from '../data/defaultLocation';
import { estimateResources, generatePlan, computeCoverage } from '../engines/planning';
import { distanceMeters, pointInPolygon } from '../engines/geometry';
import { closeDrawnPolygon } from '../engines/geometry/drawing';
import { getWeather } from '../services/weather';
import { exportMission } from '../services/missionStorage';
import type { Coordinates, OperationZone, PriorityZone } from '../types/geo';
import type { WeatherInfo } from '../types/weather';
import type { PlanningResult, PlanningInput } from '../types/planning';
import type { Environment } from '../types/drone';
import type { Mission } from '../types/mission';

function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Action impossible. Réessayez.';

export function PlanningPage({ onPrepare }: { onPrepare: () => void }) {
  const { mission, setMission, setNavigationLocked } = useMission();
  const [name, setName] = useState(mission?.metadata.name ?? 'Nouvelle mission');
  const [center, setCenter] = useState<Coordinates>(mission?.location ?? [...DEFAULT_LOCATION]);
  const [recenterKey, setRecenterKey] = useState(0);
  const [locationLabel, setLocationLabel] = useState(mission ? 'Localisation de la mission' : 'Toulouse');
  const [when, setWhen] = useState(localInput(new Date(mission?.scheduledAt ?? Date.now() + 3600000)));
  const [environment, setEnvironment] = useState<Environment>(mission?.constraints.environment ?? 'urban');
  const [capabilityId, setCapabilityId] = useState(mission?.constraints.capabilityId ?? mission?.drones[0]?.capabilityId ?? 'tp1-out-of-sight');
  const [operationZone, setOperationZone] = useState<OperationZone | null>(mission?.operationZone ?? null);
  const [priorityZones, setPriorityZones] = useState<PriorityZone[]>(mission?.priorityZones ?? []);
  const [drawing, setDrawing] = useState<'operation' | 'priority' | null>(null);
  const [vertices, setVertices] = useState<Coordinates[]>([]);
  const verticesRef = useRef<Coordinates[]>([]);
  const [weather, setWeather] = useState<WeatherInfo | null>(mission?.weather ?? null);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [result, setResult] = useState<PlanningResult | null>(() => mission?.estimate ? {
    missionId: mission.metadata.id, estimate: mission.estimate, drones: mission.drones, pilots: mission.pilots,
    operationZone: mission.operationZone, priorityZones: mission.priorityZones, warnings: [],
  } : null);
  const [panel, setPanel] = useState<string | null>(null);
  const [fleetOpen, setFleetOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeId = useRef(0);
  const missionId = useRef(mission?.metadata.id ?? crypto.randomUUID());
  const weatherRequest = useRef(0);
  const weatherAbort = useRef<AbortController | null>(null);
  const saved = useRef(mission);
  const notify = (kind: Notice['kind'], text: string) => setNotice({ kind, message: text, id: ++noticeId.current });
  useEffect(() => () => { setNavigationLocked(false); weatherRequest.current++; weatherAbort.current?.abort(); }, []);
  const invalidate = () => { setResult(null); setMission(null); setSelected(null); };
  const invalidateWeather = () => { invalidate(); weatherRequest.current++; weatherAbort.current?.abort(); setWeather(null); setLoadingWeather(false); };
  function configuration() {
    const date = new Date(when);
    if (!Number.isFinite(date.getTime()) || localInput(date) !== when) throw new Error('Date/heure locale invalide.');
    if (!name.trim()) throw new Error('Renseignez le nom de la mission.');
    return { location: [...center] as Coordinates, scheduledAt: date.toISOString() };
  }
  function startDrawing(kind: 'operation' | 'priority') {
    if (drawing) return;
    if (kind === 'priority' && !operationZone) { notify('error', 'Définissez d’abord la zone d’opération.'); return; }
    invalidate(); setPanel(null); setFleetOpen(false); setNotice(null);
    verticesRef.current = []; setVertices([]); setDrawing(kind); setNavigationLocked(true);
  }
  function addVertex(point: Coordinates) {
    const current = verticesRef.current;
    if (current.length >= 300) { notify('error', 'Maximum 300 sommets. Terminez ou annulez le dessin.'); return; }
    if (current.length && distanceMeters(current.at(-1)!, point) < 1) return;
    verticesRef.current = [...current, point]; setVertices(verticesRef.current);
  }
  function cancelDrawing() {
    verticesRef.current = []; setVertices([]); setDrawing(null); setNavigationLocked(false);
    notify('info', 'Dessin annulé. Les zones précédemment validées sont conservées.');
  }
  function finishDrawing() {
    if (!drawing) return;
    try {
      const geometry = closeDrawnPolygon(verticesRef.current);
      if (drawing === 'operation') {
        setOperationZone({ type: 'Feature', geometry, properties: { id: 'operation-1', name: 'Zone opération', kind: 'operation' } });
        setPriorityZones(zones => zones.filter(z => z.geometry.coordinates[0]!.every(p => pointInPolygon(p, geometry))));
      } else {
        if (!operationZone || !verticesRef.current.every(p => pointInPolygon(p, operationZone.geometry))) throw new Error('Placez les sommets prioritaires à l’intérieur de la zone d’opération.');
        if (priorityZones.length >= 20) throw new Error('Maximum 20 zones prioritaires.');
        setPriorityZones(zones => [...zones, { type: 'Feature', geometry, properties: { id: crypto.randomUUID(), name: `Priorité ${zones.length + 1}`, kind: 'priority' } }]);
      }
      verticesRef.current = []; setVertices([]); setDrawing(null); setNavigationLocked(false);
      notify('success', drawing === 'operation' ? 'Zone d’opération fermée et validée.' : 'Zone prioritaire fermée et validée.');
    } catch (error) { notify('error', `${message(error)} Le dessin reste ouvert : corrigez-le ou annulez pour recommencer.`); }
  }
  async function requestWeather() {
    if (drawing) return;
    try {
      const { location, scheduledAt } = configuration();
      const request = ++weatherRequest.current;
      weatherAbort.current?.abort(); weatherAbort.current = new AbortController();
      setLoadingWeather(true); invalidate();
      const next = await getWeather(location[1], location[0], scheduledAt, { signal: weatherAbort.current.signal });
      if (request === weatherRequest.current) {
        setWeather(next); setLoadingWeather(false);
        notify(next.status === 'available' ? 'success' : 'info', next.status === 'available' ? 'Prévision météo récupérée.' : 'Prévision météo indisponible pour cette échéance.');
      }
    } catch (error) { setLoadingWeather(false); notify('error', message(error)); }
  }
  function calculate() {
    if (drawing) return;
    try {
      const { location, scheduledAt } = configuration();
      if (!operationZone) throw new Error('Dessinez et terminez la zone d’opération.');
      const actualWeather: WeatherInfo = weather ?? { status: 'unavailable', location, dateTime: scheduledAt, rainDetected: null, dayNight: 'unknown', source: null };
      const input: PlanningInput = { missionId: missionId.current, location, scheduledAt, operationZone, priorityZones,
        weather: actualWeather, constraints: { environment, minimumVerticalSeparationMeters: 10, defaultWorkingAngleDegrees: 360, capabilityId },
        catalog: DRONE_CATALOG, capabilityId, availableResources: { dronesByModel: { 'dji-matrice-4t': 0, 'dji-mavic-3-enterprise': 0, 'dji-mini-5': 0 } } };
      const estimate = estimateResources(input);
      const proposed = generatePlan({ ...input, availableResources: { dronesByModel: estimate.dronesByModel } });
      const now = new Date().toISOString();
      const next: Mission = { schemaVersion: '1.0', metadata: { id: missionId.current, name: name.trim(), createdAt: saved.current?.metadata.createdAt ?? now, updatedAt: now },
        scheduledAt, location, operationZone, priorityZones, weather: actualWeather, constraints: input.constraints, estimate,
        availableResources: { dronesByModel: { ...estimate.dronesByModel } }, pilots: proposed.pilots, drones: proposed.drones, status: 'planned' };
      setResult(proposed); setMission(next); saved.current = next; setPanel('information'); setFleetOpen(false);
      notify('success', `Dispositif calculé : ${proposed.drones.length} drones proposés.`);
    } catch (error) { notify('error', message(error)); }
  }
  const metrics = result ? computeCoverage(result) : null;
  const exportJson = () => { if (!mission) return; try { exportMission(mission); notify('success', 'Mission exportée en JSON.'); } catch (error) { notify('error', message(error)); } };
  const titles: Record<string, string> = { configuration: 'Configuration mission', zones: 'Zones cartographiques', weather: 'Météo', information: 'Configuration proposée' };
  return <MapWorkspace tools={[{ id: 'configuration', label: 'Mission', icon: '⚙' }, { id: 'zones', label: 'Zones', icon: '◇' }, { id: 'weather', label: 'Météo', icon: '☀' }, { id: 'information', label: 'Informations', icon: 'i' }]}
    panel={panel} onPanel={setPanel} title={titles[panel ?? ''] ?? ''} locked={!!drawing} fleetOpen={fleetOpen} onFleet={() => setFleetOpen(open => !open)}
    fleet={<FleetPanel drones={result?.drones ?? []} missionId={missionId.current} selected={selected} onSelect={setSelected} onClose={() => setFleetOpen(false)} />}
    status={<><strong>{name}</strong><span>01 · Planification</span><WeatherBadge weather={weather} loading={loadingWeather} /></>}
    panelContent={<>
      {panel === 'configuration' && <><label>Nom de mission<input value={name} onChange={e => { setName(e.target.value); invalidate(); }} maxLength={120} /></label>
        <p className="location-label">⌖ {locationLabel}</p><p className="muted">{center[1].toFixed(5)}, {center[0].toFixed(5)} · Utilisez la barre de recherche pour changer de lieu.</p>
        <label>Date et heure<input type="datetime-local" value={when} onInput={e => { setWhen(e.currentTarget.value); invalidateWeather(); }} /></label>
        <p className="muted">Heure locale : {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
        <label>Environnement<select value={environment} onChange={e => { setEnvironment(e.target.value as Environment); invalidate(); }}><option value="urban">Urbain</option><option value="rural">Rural</option></select></label>
        <label>Scénario<select value={capabilityId} onChange={e => { setCapabilityId(e.target.value); invalidate(); }}><option value="tp1-out-of-sight">TP1 hors vue · 1 km</option><option value="tp2-out-of-sight">TP2 hors vue · 2 km</option><option value="tp1-in-sight">TP1 en vue · portée inconnue</option></select></label>
        {capabilityId === 'tp1-in-sight' && <p className="notice">Calcul indisponible : portée en vue non définie.</p>}
        <button className="primary wide" onClick={() => setPanel('zones')}>Définir les zones →</button></>}
      {panel === 'zones' && <><p className="muted">Posez les sommets sur la carte, puis cliquez le premier point ou « Terminer » pour fermer automatiquement la zone.</p>
        <button className="wide" onClick={() => startDrawing('operation')}>Dessiner la zone d’opération</button>
        <button className="wide" disabled={!operationZone} onClick={() => startDrawing('priority')}>Dessiner une zone prioritaire</button>
        {operationZone && <p className="notice success">✓ Zone d’opération validée · {operationZone.geometry.coordinates[0]!.length - 1} sommets</p>}
        {priorityZones.map(zone => <div className="zone-row" key={zone.properties.id}><span>{zone.properties.name}</span><button aria-label={`Supprimer ${zone.properties.name}`} onClick={() => { setPriorityZones(zones => zones.filter(p => p.properties.id !== zone.properties.id)); invalidate(); notify('info', 'Zone prioritaire supprimée.'); }}>Supprimer</button></div>)}
        {operationZone && <button className="text-button" onClick={() => { setOperationZone(null); setPriorityZones([]); invalidate(); notify('info', 'Zones effacées. Vous pouvez recommencer.'); }}>Effacer toutes les zones</button>}
        <button className="primary wide" disabled={!operationZone || loadingWeather || capabilityId === 'tp1-in-sight'} onClick={calculate}>Calculer l’estimation</button></>}
      {panel === 'weather' && <><WeatherBadge weather={weather} loading={loadingWeather} /><p className="muted">Prévision horaire au lieu et à la date de la mission.</p>
        <button className="wide" disabled={loadingWeather} onClick={() => void requestWeather()}>{loadingWeather ? 'Récupération…' : 'Obtenir la météo'}</button>
        {weather?.status === 'unavailable' && <p className="notice">Prévision météo indisponible pour cette échéance.</p>}
        {weather?.rainDetected && <p className="notice warning">Pluie prévue : DJI Mini 5 incompatibles.</p>}
        {weather?.source && <p className="muted">Source : <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">{weather.source}</a></p>}
        <p className="muted">Jour / nuit : inconnu.</p><button className="primary wide" disabled={!operationZone || loadingWeather || capabilityId === 'tp1-in-sight'} onClick={calculate}>Calculer l’estimation</button></>}
      {panel === 'information' && (result && metrics ? <><MetricsPanel metrics={metrics} />
        <div className="resource-summary">{DRONE_CATALOG.map(model => <span key={model.id}>{model.name} : <strong>{result.estimate.dronesByModel[model.id]}</strong></span>)}</div>
        {result.warnings.map((warning, index) => <p className="notice warning" key={index}>{warning}</p>)}
        <details><summary>Comprendre la proposition</summary><ul>{result.estimate.assumptions.map(a => <li key={a}>{a}</li>)}</ul></details>
        <div className="actions"><button onClick={exportJson}>Exporter la mission JSON</button><button className="primary" onClick={onPrepare}>Préparer l’opération →</button></div>
      </> : <><p className="notice">Définissez vos zones puis calculez une estimation.</p><button className="primary" onClick={() => setPanel('zones')}>Définir les zones</button></>)}
    </>}
    floating={<>
      <LocationSearch center={center} disabled={!!drawing} onError={text => notify('error', text)} onLocate={(point, label) => { if (drawing) return; if (point[0] !== center[0] || point[1] !== center[1]) invalidateWeather(); setCenter(point); setRecenterKey(n => n + 1); setLocationLabel(label); notify('success', `Carte centrée : ${label}`); }} />
      {drawing && <div className="drawing-bar" role="region" aria-label="Dessin en cours"><div><strong>{drawing === 'operation' ? 'Zone d’opération' : 'Zone prioritaire'}</strong><span>{vertices.length} sommets · Cliquez le premier point pour fermer</span></div><button className="primary" onClick={finishDrawing}>✓ Terminer</button><button onClick={cancelDrawing}>Annuler</button></div>}
      <Notification notice={notice} onClose={() => setNotice(null)} />
    </>}>
    <MissionMap center={center} recenterKey={recenterKey} operationZone={operationZone} priorityZones={priorityZones} drawing={!!drawing} vertices={vertices} onVertex={addVertex} onFinish={finishDrawing}
      drones={result?.drones ?? []} pilots={result?.pilots ?? []} uncoveredPoints={metrics?.uncoveredPoints ?? []} selected={selected} onSelect={setSelected} />
  </MapWorkspace>;
}
