import { useState } from 'react';
import type { DroneInstance } from '../../types/drone';
import type { MissionChange } from '../../types/operations';
import { DRONE_CATALOG } from '../../data/droneCatalog';

export function DroneControls({ drone, maxAltitude, active, onChange }: {
  drone: DroneInstance; maxAltitude: number; active: boolean; onChange: (change: MissionChange) => void;
}) {
  const [altitude, setAltitude] = useState(String(drone.altitudeMetersAgl));
  const [heading, setHeading] = useState(String(drone.coverage.headingDegrees));
  const [angle, setAngle] = useState(String(drone.coverage.workingAngleDegrees));
  const enabled = active && drone.status === 'active';
  return <div className="drone-controls"><h3>{drone.id} · {DRONE_CATALOG.find(m => m.id === drone.modelId)?.name}</h3>
    <p className="muted">{drone.pilotId} · Rayon {drone.coverage.radiusMeters} m · {drone.capabilityId}</p>
    <label>Altitude (m/sol)<input type="number" min={0} max={maxAltitude} step={1} disabled={!enabled} value={altitude} onChange={e => setAltitude(e.target.value)} /></label>
    <button disabled={!enabled || !altitude.trim() || !Number.isFinite(Number(altitude))} onClick={() => onChange({ type: 'set_altitude', droneId: drone.id, altitudeMetersAgl: Number(altitude) })}>Appliquer l’altitude</button>
    <p className="muted">Plafond scénario : {maxAltitude} m · séparation minimale : 10 m en chevauchement.</p>
    <div className="field-row"><label>Cap (°)<input type="number" min={0} max={359} step={1} disabled={!enabled} value={heading} onChange={e => setHeading(e.target.value)} /></label>
      <label>Angle de travail (°)<input type="number" min={1} max={360} step={1} disabled={!enabled} value={angle} onChange={e => setAngle(e.target.value)} /></label></div>
    <button disabled={!enabled || !heading.trim() || !angle.trim()} onClick={() => onChange({ type: 'set_coverage', droneId: drone.id, headingDegrees: Number(heading), workingAngleDegrees: Number(angle) })}>Appliquer le cap et l’angle</button>
    <p className="muted">360° : disque · angle réduit : secteur orienté.</p>
    <button disabled={!active || !['active', 'unavailable'].includes(drone.status)} onClick={() => onChange({ type: 'set_availability', droneId: drone.id, status: drone.status === 'unavailable' ? 'active' : 'unavailable' })}>
      {drone.status === 'unavailable' ? 'Rendre le drone disponible' : 'Marquer le drone indisponible'}</button>
  </div>;
}
