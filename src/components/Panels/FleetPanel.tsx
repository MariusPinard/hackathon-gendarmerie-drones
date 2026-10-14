import type { DroneInstance, DroneModel } from '../../types/drone';
import { DRONE_CATALOG } from '../../data/droneCatalog';

export const DRONE_STATE_LABELS = { ready: 'Prêt', active: 'Actif', unavailable: 'Indisponible', returning: 'Retour', emergency_landing: 'Atterrissage', completed: 'Terminé' };

export function FleetPanel({ drones, selected, onSelect, onClose, catalog = DRONE_CATALOG }: {
  drones: DroneInstance[]; missionId?: string; selected: string | null; onSelect: (id: string) => void; onClose: () => void; catalog?: readonly DroneModel[];
}) {
  return <><div className="slide-panel-heading"><h2>Flotte <span className="badge">{drones.length}</span></h2><button aria-label="Fermer la flotte" onClick={onClose}>›</button></div>
    <p className="fleet-note">Dispositif simulé · hauteur au-dessus du sol</p><div className="fleet-table-heading"><span>Drone / état</span><span>Hauteur</span></div>
    <div className="fleet-rows">{!drones.length && <p className="muted">Calculez un dispositif pour afficher les drones.</p>}{drones.map((drone, index) => {
      return <button className={`fleet-row ${selected === `drone:${drone.id}` ? 'selected-row' : ''}`} key={drone.id} onClick={() => onSelect(`drone:${drone.id}`)}>
        <span className="fleet-drone"><strong>D{index + 1} · {catalog.find(m => m.id === drone.modelId)?.name.replace('DJI ', '') ?? drone.modelId}</strong><small>{DRONE_STATE_LABELS[drone.status]}</small></span>
        <span className="fleet-altitude">{drone.altitudeMetersAgl.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} <small>m</small></span>
      </button>;
    })}</div></>;
}
