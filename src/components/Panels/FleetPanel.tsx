import type { DroneInstance } from '../../types/drone';
import { DRONE_CATALOG } from '../../data/droneCatalog';

export const DRONE_STATE_LABELS = { ready: 'Prêt', active: 'Actif', unavailable: 'Indisponible', returning: 'Retour', emergency_landing: 'Atterrissage', completed: 'Terminé' };

/** Pseudorandom demo values, stable across renders; never telemetry or persisted mission data. */
export function demoBatteryPercent(id: string): number {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x45d9f3b); hash ^= hash >>> 16;
  return 12 + (hash >>> 0) % 89;
}

export function FleetPanel({ drones, missionId, selected, onSelect, onClose }: {
  drones: DroneInstance[]; missionId: string; selected: string | null; onSelect: (id: string) => void; onClose: () => void;
}) {
  return <><div className="slide-panel-heading"><h2>Flotte <span className="badge">{drones.length}</span></h2><button aria-label="Fermer la flotte" onClick={onClose}>›</button></div>
    <p className="fleet-note">Batteries simulées · valeurs fictives</p><div className="fleet-table-heading"><span>Drone / état</span><span>Batterie</span><span>Hauteur</span></div>
    <div className="fleet-rows">{!drones.length && <p className="muted">Calculez un dispositif pour afficher les drones.</p>}{drones.map((drone, index) => {
      const battery = demoBatteryPercent(`${missionId}:${drone.id}`);
      const color = battery >= 60 ? 'green' : battery >= 25 ? 'orange' : 'red';
      return <button className={`fleet-row ${selected === `drone:${drone.id}` ? 'selected-row' : ''}`} key={drone.id} onClick={() => onSelect(`drone:${drone.id}`)}>
        <span className="fleet-drone"><strong>D{index + 1} · {DRONE_CATALOG.find(m => m.id === drone.modelId)?.name.replace('DJI ', '')}</strong><small>{DRONE_STATE_LABELS[drone.status]}</small></span>
        <span className={`battery ${color}`} aria-label={`Batterie simulée ${battery} %`}><span className="battery-outline" aria-hidden="true"><span style={{ width: `${battery}%` }} /></span><span>{battery} %</span></span>
        <span className="fleet-altitude">{drone.altitudeMetersAgl.toFixed(0)} <small>m</small></span>
      </button>;
    })}</div></>;
}
