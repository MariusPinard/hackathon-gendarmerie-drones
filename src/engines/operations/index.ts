import type { Mission } from '../../types/mission';
import type { Conflict, MissionChange, OperationsResult } from '../../types/operations';
import type { Coordinates } from '../../types/geo';
import { DRONE_CATALOG } from '../../data/droneCatalog.ts';
import { assertCoordinates, distanceMeters, hasCoverage, coveragesOverlap, coverageMetrics } from '../geometry/index.ts';

export function detectConflicts(mission: Mission): Conflict[] {
  const conflicts: Conflict[] = [];
  const active = mission.drones.filter(hasCoverage);
  for (let i = 0; i < active.length; i++) {
    const drone = active[i]!;
    const model = DRONE_CATALOG.find(m => m.id === drone.modelId);
    const capability = model?.capabilities.find(c => c.id === drone.capabilityId);
    const pilot = mission.pilots.find(p => p.id === drone.pilotId);
    const add = (type: Conflict['type'], message: string) => conflicts.push({ id: `${type}-${drone.id}`, type, droneIds: [drone.id], message, approximatePosition: [...drone.dronePosition] });
    if (model?.incompatibleWithRain && mission.weather.rainDetected === true)
      add('rain_incompatibility', `${drone.id} : DJI Mini 5 incompatible avec la pluie détectée.`);
    if (!capability || !pilot) add('capability_limit', `${drone.id} : modèle, scénario ou télépilote inconnu.`);
    else {
      const altitudeMax = capability.maxAltitudeMetersAgl[mission.constraints.environment];
      if (drone.altitudeMetersAgl > altitudeMax || drone.altitudeMetersAgl < 0)
        add('capability_limit', `${drone.id} : altitude hors plafond ${altitudeMax} m/sol.`);
      if (pilot.qualification !== capability.pilotQualification)
        add('capability_limit', `${drone.id} : qualification du télépilote incompatible avec le scénario choisi.`);
      if (capability.rangeMeters === null) add('capability_limit', `${drone.id} : portée en vue non définie.`);
      else if (distanceMeters(pilot.pilotPosition, drone.dronePosition) > capability.rangeMeters + 1
        || drone.coverage.radiusMeters > capability.rangeMeters)
        add('capability_limit', `${drone.id} : portée ${capability.rangeMeters} m dépassée.`);
    }
    for (let j = i + 1; j < active.length; j++) {
      const other = active[j]!;
      const delta = Math.abs(drone.altitudeMetersAgl - other.altitudeMetersAgl);
      if (delta < mission.constraints.minimumVerticalSeparationMeters && coveragesOverlap(drone.coverage, other.coverage))
        conflicts.push({ id: `vertical-${drone.id}-${other.id}`, type: 'vertical_separation', droneIds: [drone.id, other.id],
          altitudeDifferenceMeters: delta, approximatePosition: [(drone.dronePosition[0] + other.dronePosition[0]) / 2, (drone.dronePosition[1] + other.dronePosition[1]) / 2],
          message: `${drone.id} / ${other.id} : couvertures en chevauchement, séparation ${delta.toFixed(1)} m < ${mission.constraints.minimumVerticalSeparationMeters} m.` });
    }
  }
  for (const model of DRONE_CATALOG) {
    const count = active.filter(d => d.modelId === model.id).length;
    if (count > mission.availableResources.dronesByModel[model.id]) conflicts.push({ id: `resource-${model.id}`, type: 'resource_shortage',
      droneIds: active.filter(d => d.modelId === model.id).map(d => d.id), message: `${model.name} : ${count} drones engagés pour ${mission.availableResources.dronesByModel[model.id]} disponibles.` });
  }
  return conflicts;
}

export function inspectMission(mission: Mission): OperationsResult {
  const coverage = coverageMetrics(mission.operationZone.geometry, mission.priorityZones, mission.drones);
  const warnings: string[] = [];
  if (coverage.totalCoveragePercent < 98 && (mission.status === 'active' || mission.status === 'ready')) warnings.push('Couverture partielle : les points rouges indiquent les secteurs non couverts.');
  if (mission.weather.rainDetected === null) warnings.push('Météo inconnue : compatibilité pluie à confirmer.');
  return { mission, coverage, conflicts: detectConflicts(mission), warnings };
}

export function startMission(source: Mission): OperationsResult {
  if (!['ready', 'planned'].includes(source.status) || !source.drones.some(d => d.status === 'ready')) throw new Error('Préparez et recalculez un dispositif avant lancement.');
  const conflicts = detectConflicts(source);
  if (conflicts.length) throw new Error('Résolvez les conflits du dispositif avant lancement.');
  const mission = structuredClone(source);
  mission.status = 'active';
  mission.drones.forEach(d => { if (d.status === 'ready') d.status = 'active'; });
  return inspectMission(mission);
}

export function recalculateMission(source: Mission, change: MissionChange): OperationsResult {
  if (source.status !== 'active') throw new Error('Les modifications sont possibles uniquement pendant une mission active.');
  const mission = structuredClone(source);
  if (change.type === 'move_pilot') {
    assertCoordinates(change.pilotPosition);
    const pilot = mission.pilots.find(p => p.id === change.pilotId);
    if (!pilot) throw new Error('Télépilote inconnu.');
    pilot.pilotPosition = [...change.pilotPosition];
  } else {
    const drone = mission.drones.find(d => d.id === change.droneId);
    if (!drone) throw new Error('Drone inconnu.');
    if (change.type !== 'set_availability' && drone.status !== 'active') throw new Error('Ce drone n’est pas actif.');
    switch (change.type) {
      case 'move_drone': assertCoordinates(change.dronePosition); drone.dronePosition = [...change.dronePosition]; drone.coverage.center = [...change.dronePosition]; break;
      case 'set_altitude': {
        const model = DRONE_CATALOG.find(m => m.id === drone.modelId)!;
        const capability = model.capabilities.find(c => c.id === drone.capabilityId)!;
        const max = capability.maxAltitudeMetersAgl[mission.constraints.environment];
        if (!Number.isFinite(change.altitudeMetersAgl) || change.altitudeMetersAgl < 0 || change.altitudeMetersAgl > max) throw new Error(`Altitude attendue : 0 à ${max} m.`);
        drone.altitudeMetersAgl = change.altitudeMetersAgl; break;
      }
      case 'set_coverage':
        if (!Number.isFinite(change.headingDegrees) || change.headingDegrees < 0 || change.headingDegrees >= 360
          || !Number.isFinite(change.workingAngleDegrees) || change.workingAngleDegrees < 1 || change.workingAngleDegrees > 360) throw new Error('Cap : 0–359° ; angle : 1–360°.');
        drone.coverage.headingDegrees = change.headingDegrees; drone.coverage.workingAngleDegrees = change.workingAngleDegrees; break;
      case 'set_availability':
        if (!['active', 'unavailable'].includes(change.status) || !['active', 'unavailable'].includes(drone.status)) throw new Error('Transition de disponibilité invalide.');
        drone.status = change.status; break;
    }
  }
  const result = inspectMission(mission);
  if (change.type === 'set_availability' && change.status === 'unavailable') result.warnings.push('Drone indisponible : couverture retirée. Les autres positions sont conservées ; une réorganisation locale peut être demandée.');
  return result;
}

/** Optional local repair: at most one active drone moves, and only if useful coverage increases. */
export function proposeLocalReorganization(source: Mission): OperationsResult {
  if (source.status !== 'active') throw new Error('Réorganisation réservée aux missions actives.');
  const before = inspectMission(source);
  let best = before, bestGain = 0;
  const targets = before.coverage.uncoveredPoints.filter((_, i) => i % 8 === 0).slice(0, 15);
  for (const drone of source.drones.filter(d => d.status === 'active')) for (const point of targets) {
    const pilot = source.pilots.find(p => p.id === drone.pilotId)!;
    const capability = DRONE_CATALOG.find(m => m.id === drone.modelId)!.capabilities.find(c => c.id === drone.capabilityId)!;
    if (capability.rangeMeters === null || distanceMeters(point, pilot.pilotPosition) > capability.rangeMeters) continue;
    const result = recalculateMission(source, { type: 'move_drone', droneId: drone.id, dronePosition: point });
    const gain = result.coverage.totalCoveragePercent - before.coverage.totalCoveragePercent
      + ((result.coverage.priorityCoveragePercent ?? 0) - (before.coverage.priorityCoveragePercent ?? 0)) * 4;
    if (gain > bestGain + 0.5 && result.conflicts.length <= before.conflicts.length) { best = result; bestGain = gain; }
  }
  return { ...best, warnings: [...best.warnings, best === before ? 'Aucun déplacement local améliorant la couverture sans aggraver les conflits.' : 'Réorganisation locale : un seul drone déplacé, positions des autres drones et télépilotes conservées.'] };
}

export function triggerEmergencyLanding(source: Mission): OperationsResult {
  if (!['active', 'returning'].includes(source.status)) throw new Error('Aucune opération en cours à arrêter.');
  const mission = structuredClone(source);
  mission.status = 'emergency';
  mission.drones.forEach(d => { if (d.status === 'active' || d.status === 'returning') d.status = 'emergency_landing'; });
  return inspectMission(mission);
}

export function triggerReturnToHome(source: Mission): OperationsResult {
  if (source.status !== 'active') throw new Error('Le retour nécessite une mission active.');
  const mission = structuredClone(source);
  mission.status = 'returning';
  mission.drones.forEach(d => { if (d.status === 'active') d.status = 'returning'; });
  if (!mission.drones.some(d => d.status === 'returning')) mission.status = 'completed';
  return inspectMission(mission);
}

/** Linear 4-second demonstration interpolation; caller supplies progress from an immutable initial snapshot. */
export function advanceSimulation(source: Mission, progress: number): OperationsResult {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new Error('Progression invalide.');
  const mission = structuredClone(source);
  if (!['returning', 'emergency'].includes(source.status)) throw new Error('Aucun retour ou atterrissage à simuler.');
  for (const drone of mission.drones) {
    if (drone.status !== 'returning' && drone.status !== 'emergency_landing') continue;
    if (drone.status === 'returning') {
      const home = mission.pilots.find(p => p.id === drone.pilotId)?.pilotPosition;
      if (!home) throw new Error('Télépilote de retour inconnu.');
      drone.dronePosition = drone.dronePosition.map((value, index) => value + (home[index]! - value) * progress) as Coordinates;
      drone.coverage.center = [...drone.dronePosition];
    }
    drone.altitudeMetersAgl *= 1 - progress;
    if (progress === 1) { drone.status = 'completed'; drone.altitudeMetersAgl = 0; }
  }
  if (source.status === 'returning' && !mission.drones.some(d => d.status === 'returning')) mission.status = 'completed';
  return inspectMission(mission);
}
