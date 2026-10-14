import type { Mission } from '../types/mission';
import { DRONE_CATALOG } from '../data/droneCatalog.ts';
import { samplePolygon } from '../engines/geometry/index.ts';
import { selectedCapability } from '../engines/planning/index.ts';
import { recalculateMission } from '../engines/operations/index.ts';
import type { MissionChange, OperationsResult } from '../types/operations';

/** Every available unit belongs to the fleet; surplus units wait for a manual engagement. */
export function retainAvailableDrones(source: Mission): Mission {
  const mission = structuredClone(source);
  const catalog = mission.droneCatalog ?? DRONE_CATALOG;
  const staging = samplePolygon(mission.operationZone.geometry).points;
  let reserveIndex = 0;
  const surplus = catalog.reduce((sum, model) => sum + Math.max(0, (mission.availableResources.dronesByModel[model.id] ?? 0) - mission.drones.filter(drone => drone.modelId === model.id).length), 0);
  const droneIds = new Set(mission.drones.map(drone => drone.id)), pilotIds = new Set(mission.pilots.map(pilot => pilot.id));
  let sequence = 1;
  for (const model of catalog) {
    const available = mission.availableResources.dronesByModel[model.id] ?? 0;
    if (!Number.isSafeInteger(available) || available < 0) throw new Error('Quantité de drones invalide.');
    const existing = mission.drones.filter(drone => drone.modelId === model.id).length;
    for (let i = existing; i < available; i++) {
      while (droneIds.has(`drone-${sequence}`) || pilotIds.has(`pilot-${sequence}`)) sequence++;
      const id = `drone-${sequence}`, pilotId = `pilot-${sequence}`;
      const position = staging[Math.floor(reserveIndex++ * staging.length / surplus) % staging.length]!;
      droneIds.add(id); pilotIds.add(pilotId);
      const capability = selectedCapability(model, mission.constraints.capabilityId === 'mixed' ? 'tp1-out-of-sight' : mission.constraints.capabilityId);
      mission.pilots.push({ id: pilotId, name: `Télépilote ${sequence}`, qualification: capability.pilotQualification, pilotPosition: [...position] });
      mission.drones.push({ id, pilotId, modelId: model.id, capabilityId: capability.id, dronePosition: [...position],
        altitudeMetersAgl: 10, status: 'reserve', coverage: { center: [...position], radiusMeters: capability.rangeMeters!,
          headingDegrees: 0, workingAngleDegrees: 360, clipPolygon: structuredClone(mission.operationZone.geometry) } });
      sequence++;
    }
  }
  return mission;
}

/** Use the same validation and conflict calculation before and during the operation. */
export function editPreparedMission(source: Mission, change: MissionChange): OperationsResult {
  if (source.status !== 'ready') throw new Error('Recalculez les ressources avant de placer un drone.');
  const temporary = structuredClone(source);
  temporary.status = 'active';
  temporary.drones.forEach(drone => { if (drone.status === 'ready') drone.status = 'active'; });
  const result = recalculateMission(temporary, change);
  result.mission.status = 'ready';
  result.mission.drones.forEach(drone => { if (drone.status === 'active') drone.status = 'ready'; });
  return result;
}
