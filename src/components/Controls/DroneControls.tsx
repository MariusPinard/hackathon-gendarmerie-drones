import { useEffect, useState } from 'react';
import type { DroneInstance } from '../../types/drone';
import type { MissionChange } from '../../types/operations';
import { DRONE_CATALOG } from '../../data/droneCatalog';

type CoverageChange = Extract<MissionChange, { type: 'set_coverage' }>;
export function DroneControls({ drone, maxAltitude, active, onChange, onPreview, onPlace }: {
  drone: DroneInstance; maxAltitude: number; active: boolean; onChange: (change: MissionChange) => void;
  onPreview: (change: CoverageChange | null) => void; onPlace: () => void;
}) {
  const [altitude, setAltitude] = useState(String(drone.altitudeMetersAgl));
  const [heading, setHeading] = useState(String(drone.coverage.headingDegrees));
  const [angle, setAngle] = useState(String(drone.coverage.workingAngleDegrees));
  useEffect(() => { setAltitude(String(drone.altitudeMetersAgl)); setHeading(String(drone.coverage.headingDegrees)); setAngle(String(drone.coverage.workingAngleDegrees)); }, [drone.id, drone.altitudeMetersAgl, drone.coverage.headingDegrees, drone.coverage.workingAngleDegrees]);
  const enabled = active && drone.status === 'active';
  const validSector = heading.trim() && angle.trim() && Number.isFinite(Number(heading)) && Number.isFinite(Number(angle)) && Number(heading) >= 0 && Number(heading) <= 359 && Number(angle) >= 1 && Number(angle) <= 360;
  function preview(nextHeading: string, nextAngle: string) {
    if (!nextHeading.trim() || !nextAngle.trim() || !Number.isFinite(Number(nextHeading)) || !Number.isFinite(Number(nextAngle)) || Number(nextHeading) < 0 || Number(nextHeading) > 359 || Number(nextAngle) < 1 || Number(nextAngle) > 360) { onPreview(null); return; }
    onPreview({ type: 'set_coverage', droneId: drone.id, headingDegrees: Number(nextHeading), workingAngleDegrees: Number(nextAngle) });
  }
  return <div className="drone-controls"><h3>{drone.id} · {DRONE_CATALOG.find(m => m.id === drone.modelId)?.name}</h3>
    <p className="muted">{drone.pilotId} · Rayon {drone.coverage.radiusMeters} m · {drone.capabilityId}</p>
    <button className="wide" disabled={!enabled} onClick={onPlace}>⌖ Déplacer le drone sur la carte</button><p className="muted">Glisser-déposer le marqueur D, ou cliquer ce bouton puis sa nouvelle position.</p>
    <label>Altitude (m/sol)<input type="number" min={0} max={maxAltitude} step={1} disabled={!enabled} value={altitude} onChange={e => setAltitude(e.target.value)} /></label>
    <button disabled={!enabled || !altitude.trim() || !Number.isFinite(Number(altitude)) || Number(altitude) < 0 || Number(altitude) > maxAltitude} onClick={() => onChange({ type: 'set_altitude', droneId: drone.id, altitudeMetersAgl: Number(altitude) })}>Appliquer l’altitude</button>
    <p className="muted">Plafond : {maxAltitude} m · séparation minimale : 10 m.</p>
    <div className="field-row"><label>Cap (°)<input type="number" min={0} max={359} step={1} disabled={!enabled} value={heading} onInput={e => { setHeading(e.currentTarget.value); preview(e.currentTarget.value, angle); }} /></label>
      <label>Angle de travail (°)<input type="number" min={1} max={360} step={1} disabled={!enabled} value={angle} onInput={e => { setAngle(e.currentTarget.value); preview(heading, e.currentTarget.value); }} /></label></div>
    <label className="range-label">Cap en direct <span>{heading || '—'}°</span></label><input type="range" aria-label="Curseur du cap" min={0} max={359} disabled={!enabled} value={Number.isFinite(Number(heading)) ? Math.max(0, Math.min(359, Number(heading))) : 0} onInput={e => { setHeading(e.currentTarget.value); preview(e.currentTarget.value, angle); }} />
    <label className="range-label">Angle en direct <span>{angle || '—'}°</span></label><input type="range" aria-label="Curseur de l’angle" min={1} max={360} disabled={!enabled} value={Number.isFinite(Number(angle)) ? Math.max(1, Math.min(360, Number(angle))) : 360} onInput={e => { setAngle(e.currentTarget.value); preview(heading, e.currentTarget.value); }} />
    <p className="notice">Aperçu immédiat sur la carte. Validez pour enregistrer le secteur dans la mission.</p>
    {!validSector && <p className="notice error">Cap attendu : 0–359° ; angle : 1–360°.</p>}
    <button className="primary wide" disabled={!enabled || !validSector} onClick={() => onChange({ type: 'set_coverage', droneId: drone.id, headingDegrees: Number(heading), workingAngleDegrees: Number(angle) })}>Appliquer le cap et l’angle</button>
    <p className="muted">360° : disque · angle réduit : secteur orienté.</p>
    <button className="wide" disabled={!active || !['active', 'unavailable'].includes(drone.status)} onClick={() => onChange({ type: 'set_availability', droneId: drone.id, status: drone.status === 'unavailable' ? 'active' : 'unavailable' })}>
      {drone.status === 'unavailable' ? 'Rendre le drone disponible' : 'Marquer le drone indisponible'}</button>
  </div>;
}
