import { useRef, useState } from 'react';
import { useMission } from '../app/AppContext';
import { MissionMap } from '../components/Map/MissionMap';
import { MetricsPanel } from '../components/Panels/MetricsPanel';
import { DRONE_CATALOG } from '../data/droneCatalog';
import { estimateResources, generatePlan, computeCoverage } from '../engines/planning';
import { distanceMeters, validatePolygon } from '../engines/geometry';
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
const message = (error: unknown) => error instanceof Error ? error.message : 'Le calcul n’a pas pu aboutir.';

export function PlanningPage({ onPrepare }: { onPrepare: () => void }) {
  const { mission, setMission } = useMission();
  const [name, setName] = useState(mission?.metadata.name ?? 'Nouvelle mission');
  const [latitude, setLatitude] = useState(String(mission?.location[1] ?? 48.1173));
  const [longitude, setLongitude] = useState(String(mission?.location[0] ?? -1.6778));
  const [center, setCenter] = useState<Coordinates>(mission?.location ?? [-1.6778, 48.1173]);
  const [when, setWhen] = useState(localInput(new Date(mission?.scheduledAt ?? Date.now() + 3600000)));
  const [environment, setEnvironment] = useState<Environment>(mission?.constraints.environment ?? 'urban');
  const [capabilityId, setCapabilityId] = useState(mission?.drones[0]?.capabilityId ?? 'tp1-out-of-sight');
  const [operationZone, setOperationZone] = useState<OperationZone | null>(mission?.operationZone ?? null);
  const [priorityZones, setPriorityZones] = useState<PriorityZone[]>(mission?.priorityZones ?? []);
  const [drawing, setDrawing] = useState<'operation' | 'priority' | null>(null);
  const [vertices, setVertices] = useState<Coordinates[]>([]);
  const [weather, setWeather] = useState<WeatherInfo | null>(mission?.weather ?? null);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [result, setResult] = useState<PlanningResult | null>(null);
  const [error, setError] = useState('');
  const missionId = useRef(mission?.metadata.id ?? crypto.randomUUID());
  const weatherRequest = useRef(0);
  const saved = useRef(mission);
  const invalidate = () => { setResult(null); setMission(null); setError(''); };
  const invalidateWeather = () => { invalidate(); weatherRequest.current++; setWeather(null); setLoadingWeather(false); };
  function configuration() {
    const location: Coordinates = [Number(longitude), Number(latitude)];
    if (!latitude.trim() || !longitude.trim() || !location.every(Number.isFinite) || Math.abs(location[0]) > 180 || Math.abs(location[1]) > 75)
      throw new Error('Renseignez une longitude valide et une latitude entre −75° et 75°.');
    const date = new Date(when);
    if (!Number.isFinite(date.getTime()) || localInput(date) !== when) throw new Error('Date/heure locale invalide.');
    if (!name.trim()) throw new Error('Renseignez le nom de la mission.');
    return { location, scheduledAt: date.toISOString() };
  }
  function startDrawing(kind: 'operation' | 'priority') {
    invalidate(); setVertices([]); setDrawing(kind);
  }
  function addVertex(point: Coordinates) {
    setVertices(current => current.length >= 300 ? current :
      current.length && distanceMeters(current.at(-1)!, point) < 1 ? current : [...current, point]);
  }
  function finishDrawing() {
    try {
      if (vertices.length < 3) throw new Error('Ajoutez au moins trois sommets.');
      const geometry = { type: 'Polygon' as const, coordinates: [[...vertices, vertices[0]!]] };
      validatePolygon(geometry);
      if (drawing === 'operation') setOperationZone({ type: 'Feature', geometry, properties: { id: 'operation-1', name: 'Zone opération', kind: 'operation' } });
      if (drawing === 'priority') {
        if (priorityZones.length >= 20) throw new Error('Maximum 20 zones prioritaires.');
        setPriorityZones(zones => [...zones, { type: 'Feature', geometry, properties: {
          id: crypto.randomUUID(), name: `Priorité ${zones.length + 1}`, kind: 'priority',
        } }]);
      }
      setDrawing(null); setVertices([]); setError('');
    } catch (err) { setError(message(err)); }
  }
  async function requestWeather() {
    try {
      const { location, scheduledAt } = configuration();
      const request = ++weatherRequest.current;
      setLoadingWeather(true); setError(''); setCenter(location); invalidate();
      const next = await getWeather(location[1], location[0], scheduledAt);
      if (request === weatherRequest.current) { setWeather(next); setLoadingWeather(false); }
    } catch (err) { setLoadingWeather(false); setError(message(err)); }
  }
  function calculate() {
    try {
      const { location, scheduledAt } = configuration();
      if (!operationZone) throw new Error('Dessinez et terminez la zone d’opération.');
      const actualWeather: WeatherInfo = weather ?? { status: 'unavailable', location, dateTime: scheduledAt, rainDetected: null, dayNight: 'unknown', source: null };
      const input: PlanningInput = { missionId: missionId.current, location, scheduledAt, operationZone, priorityZones,
        weather: actualWeather, constraints: { environment, minimumVerticalSeparationMeters: 10, defaultWorkingAngleDegrees: 360 },
        catalog: DRONE_CATALOG, capabilityId, availableResources: { dronesByModel: { 'dji-matrice-4t': 0, 'dji-mavic-3-enterprise': 0, 'dji-mini-5': 0 } } };
      const estimate = estimateResources(input);
      const proposed = generatePlan({ ...input, availableResources: { dronesByModel: estimate.dronesByModel } });
      const now = new Date().toISOString();
      const next: Mission = { schemaVersion: '1.0', metadata: { id: missionId.current, name: name.trim(), createdAt: saved.current?.metadata.createdAt ?? now, updatedAt: now },
        scheduledAt, location, operationZone, priorityZones, weather: actualWeather, constraints: input.constraints, estimate,
        availableResources: { dronesByModel: { ...estimate.dronesByModel } }, pilots: proposed.pilots, drones: proposed.drones, status: 'planned' };
      setResult(proposed); setMission(next); saved.current = next; setError('');
    } catch (err) { setError(message(err)); }
  }
  const metrics = result ? computeCoverage(result) : null;
  return <section>
    <div className="page-title"><div><p className="eyebrow">01 / PLANIFICATION</p><h1>Préparer le dispositif</h1><p>Définissez la zone, puis calculez une configuration proposée.</p></div></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="workspace">
      <aside className="panel planning-panel">
        <h2>Configuration mission</h2>
        <label>Nom de mission<input value={name} onChange={e => { setName(e.target.value); invalidate(); }} maxLength={120} /></label>
        <div className="field-row"><label>Latitude<input type="number" step="any" value={latitude} onChange={e => { setLatitude(e.target.value); invalidateWeather(); }} /></label>
          <label>Longitude<input type="number" step="any" value={longitude} onChange={e => { setLongitude(e.target.value); invalidateWeather(); }} /></label></div>
        <button onClick={() => { try { setCenter(configuration().location); setError(''); } catch (err) { setError(message(err)); } }}>Centrer la carte</button>
        <label>Date et heure<input type="datetime-local" value={when} onChange={e => { setWhen(e.target.value); invalidateWeather(); }} /></label>
        <p className="muted">Heure locale : {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
        <div className="field-row"><label>Environnement<select value={environment} onChange={e => { setEnvironment(e.target.value as Environment); invalidate(); }}><option value="urban">Urbain</option><option value="rural">Rural</option></select></label>
          <label>Scénario<select value={capabilityId} onChange={e => { setCapabilityId(e.target.value); invalidate(); }}><option value="tp1-out-of-sight">TP1 hors vue · 1 km</option><option value="tp2-out-of-sight">TP2 hors vue · 2 km</option><option value="tp1-in-sight">TP1 en vue · portée inconnue</option></select></label></div>
        {capabilityId === 'tp1-in-sight' && <p className="notice">Estimation indisponible : la portée en vue n’est pas définie.</p>}
        <h2>Zones cartographiques</h2>
        <button disabled={!!drawing} onClick={() => startDrawing('operation')}>Dessiner la zone d’opération</button>
        <button disabled={!!drawing || !operationZone} onClick={() => startDrawing('priority')}>Dessiner une zone prioritaire</button>
        {drawing && <div className="notice"><strong>{drawing === 'operation' ? 'Zone opération' : 'Zone prioritaire'} · {vertices.length} sommets</strong><p>Cliquez sur la carte. Terminez par double clic ou le bouton ci-dessous.</p>
          <button onClick={finishDrawing}>Terminer</button><button onClick={() => { setDrawing(null); setVertices([]); setError(''); }}>Annuler</button><button disabled={!vertices.length} onClick={() => setVertices(v => v.slice(0, -1))}>Retirer le dernier sommet</button></div>}
        {operationZone && <button className="text-button" disabled={!!drawing} onClick={() => { setOperationZone(null); setPriorityZones([]); invalidate(); }}>Effacer toutes les zones</button>}
        {priorityZones.map(z => <div className="zone-row" key={z.properties.id}><span>{z.properties.name}</span><button disabled={!!drawing} aria-label={`Supprimer ${z.properties.name}`} onClick={() => { setPriorityZones(zones => zones.filter(p => p.properties.id !== z.properties.id)); invalidate(); }}>Supprimer</button></div>)}
        <h2>Météo</h2>
        <button disabled={loadingWeather} onClick={() => void requestWeather()}>{loadingWeather ? 'Récupération…' : 'Obtenir la météo'}</button>
        <p className={weather?.rainDetected ? 'notice warning' : 'muted'} aria-live="polite">{!weather ? 'Prévision non demandée.' : weather.status === 'unavailable' ? 'Prévision météo indisponible pour cette échéance.' : weather.rainDetected ? 'Pluie prévue — DJI Mini 5 incompatibles.' : 'Pas de pluie prévue sur le créneau horaire.'}</p>
        {weather?.source && <p className="muted">Source : <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">{weather.source}</a> · prévision horaire</p>}
        <p className="muted">Jour / nuit : inconnu (calcul astronomique non intégré).</p>
        <button className="primary wide" disabled={!operationZone || !!drawing || loadingWeather || capabilityId === 'tp1-in-sight'} onClick={calculate}>Calculer l’estimation</button>
      </aside>
      <div className="map-column"><MissionMap center={center} operationZone={operationZone} priorityZones={priorityZones} drawing={!!drawing} vertices={vertices} onVertex={addVertex} onFinish={finishDrawing}
        drones={result?.drones ?? []} pilots={result?.pilots ?? []} uncoveredPoints={metrics?.uncoveredPoints ?? []} />
        {result && metrics && <div className="panel"><h2>Configuration proposée</h2><MetricsPanel metrics={metrics} />
          <div className="resource-summary">{DRONE_CATALOG.map(m => <span key={m.id}>{m.name} : <strong>{result.estimate.dronesByModel[m.id]}</strong></span>)}</div>
          {result.warnings.map((warning, i) => <p className="notice warning" key={i}>{warning}</p>)}
          <details><summary>Comprendre la proposition</summary><ul>{result.estimate.assumptions.map(a => <li key={a}>{a}</li>)}</ul></details>
          <div className="actions"><button onClick={() => { if (mission) { try { exportMission(mission); } catch (err) { setError(message(err)); } } }}>Exporter la mission JSON</button><button className="primary" onClick={onPrepare}>Préparer l’opération →</button></div>
        </div>}
      </div>
    </div>
  </section>;
}
