import { useEffect, useState } from 'react';
import type { DroneInstance, DroneModel } from '../../types/drone';
export function PlanningDroneEditor({ drone, model, onChange, maxRangeMeters }: { drone: DroneInstance; model: DroneModel; maxRangeMeters?: number; onChange: (change: { headingDegrees: number; workingAngleDegrees: number; radiusMeters: number }) => void }) {
  const [heading, setHeading] = useState(String(drone.coverage.headingDegrees)), [angle, setAngle] = useState(String(drone.coverage.workingAngleDegrees)), [radius, setRadius] = useState(String(Math.round(drone.coverage.radiusMeters)));
  useEffect(() => { setHeading(String(drone.coverage.headingDegrees)); setAngle(String(drone.coverage.workingAngleDegrees)); setRadius(String(Math.round(drone.coverage.radiusMeters))); }, [drone.id]);
  const maxRange = Math.min(maxRangeMeters ?? Infinity, Math.max(...model.capabilities.map(c => c.rangeMeters ?? 0)));
  const update = (h: string, a: string, r: string) => { if (h.trim() && a.trim() && r.trim() && [h, a, r].every(s => Number.isFinite(Number(s))) && Number(h) >= 0 && Number(h) < 360 && Number(a) >= 1 && Number(a) <= 360 && Number(r) > 0 && Number(r) <= maxRange) onChange({ headingDegrees: Number(h), workingAngleDegrees: Number(a), radiusMeters: Number(r) }); };
  return <><h3>{model.name}</h3><p className="planner-sector-note muted">Aperçu immédiat. La zone de travail reste découpée à la zone d’opération. Un rayon ≤ 1 km est affecté à TP1.</p>
    <div className="field-row"><label>Cap (°)<input type="number" min={0} max={359} value={heading} onChange={e => { setHeading(e.target.value); update(e.target.value, angle, radius); }} /></label><label>Angle de travail (°)<input type="number" min={1} max={360} value={angle} onChange={e => { setAngle(e.target.value); update(heading, e.target.value, radius); }} /></label></div>
    <label>Rayon de travail (m)<input type="number" min={1} max={maxRange} value={radius} onChange={e => { setRadius(e.target.value); update(heading, angle, e.target.value); }} /></label>
    {heading && angle && radius && (Number(heading) < 0 || Number(heading) >= 360 || Number(angle) < 1 || Number(angle) > 360 || Number(radius) <= 0 || Number(radius) > maxRange) && <p className="notice error" role="alert">Cap 0–359°, angle 1–360°, rayon 1–{maxRange} m.</p>}
    <p className="muted">Altitude proposée : {drone.altitudeMetersAgl.toLocaleString('fr-FR')} m · {drone.capabilityId.startsWith('tp2') ? 'TP2' : 'TP1'}</p>
  </>;
}
