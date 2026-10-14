import type { CoverageMetrics, PlanningInput, PlanningResult, ResourceEstimate } from '../../types/planning';
import type { DroneCapability, DroneModel, DroneModelId, AvailableResources } from '../../types/drone';
import type { Coordinates } from '../../types/geo';
import { coverageMetrics, samplePolygon, pointInPolygon, pointInCoverage, coveragesOverlap, validatePolygon } from '../geometry/index.ts';

export const MAX_PLANNING_DRONES = 2000;
const PRIORITY_WEIGHT = 4;

export function selectedCapability(model: DroneModel, capabilityId = 'tp1-out-of-sight'): DroneCapability {
  const capability = model.capabilities.find(c => c.id === capabilityId);
  if (!capability || capability.rangeMeters === null || capability.rangeMeters <= 0)
    throw new Error('Le scénario « en vue » ne peut pas être calculé tant que sa portée n’est pas définie.');
  return capability;
}

function plan(input: PlanningInput, available: AvailableResources): PlanningResult {
  if (!Number.isFinite(input.constraints.minimumVerticalSeparationMeters)
    || input.constraints.minimumVerticalSeparationMeters < 10) throw new Error('Séparation verticale minimale : 10 m.');
  if (!['rural', 'urban'].includes(input.constraints.environment)) throw new Error('Environnement invalide.');
  if (input.constraints.defaultWorkingAngleDegrees !== 360) throw new Error('Le dispositif initial utilise un angle de 360°. Les secteurs se règlent en conduite.');
  if (input.priorityZones.length > 20) throw new Error('Maximum 20 zones prioritaires.');
  input.priorityZones.forEach(zone => validatePolygon(zone.geometry));
  const eligible = input.catalog.filter(m => !(m.incompatibleWithRain && input.weather.rainDetected === true));
  const capabilities = eligible.map(m => selectedCapability(m, input.capabilityId));
  if (!eligible.length) throw new Error('Aucun modèle compatible disponible dans le catalogue.');
  const counts: Record<string, number> = {};
  for (const model of input.catalog) {
    const count = available.dronesByModel[model.id];
    if (!Number.isSafeInteger(count) || count < 0 || count > 2000) throw new Error('Quantité de drones abérante!');
    counts[model.id] = count;
  }
  const grid = samplePolygon(input.operationZone.geometry);
  const candidates = samplePolygon(input.operationZone.geometry, 16).points;
  const priority = grid.points.map(p => input.priorityZones.some(z => pointInPolygon(p, z.geometry)));
  const coverCounts = new Uint8Array(grid.points.length);
  const cache = new Map<number, number[][]>();
  for (const capability of capabilities) {
    const radius = capability.rangeMeters!;
    if (!cache.has(radius)) cache.set(radius, candidates.map(center => {
      const coverage = { center, radiusMeters: radius, headingDegrees: 0, workingAngleDegrees: 360 };
      return grid.points.flatMap((p, i) => pointInCoverage(p, coverage) ? [i] : []);
    }));
  }
  const result: PlanningResult = {
    missionId: input.missionId, estimate: { dronesByModel: {
      'dji-matrice-4t': 0, 'dji-mavic-3-enterprise': 0, 'dji-mini-5': 0,
    }, pilotCount: 0, assumptions: [] },
    pilots: [], drones: [], operationZone: structuredClone(input.operationZone),
    priorityZones: structuredClone(input.priorityZones), warnings: [],
  };
  const used = new Set<string>();
  let modelCursor = 0;
  for (let iteration = 0; iteration < MAX_PLANNING_DRONES; iteration++) {
    let model: DroneModel | undefined;
    for (let offset = 0; offset < eligible.length; offset++) {
      const candidate = eligible[(modelCursor + offset) % eligible.length]!;
      if (counts[candidate.id]! > 0) { model = candidate; modelCursor = (modelCursor + offset + 1) % eligible.length; break; }
    }
    if (!model) break;
    const capability = selectedCapability(model, input.capabilityId);
    const options = cache.get(capability.rangeMeters!)!;
    let bestIndex = -1, bestScore = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(`${capability.rangeMeters}:${i}`)) continue;
      let score = 0, newCount = 0;
      for (const index of options[i]!) {
        const count = coverCounts[index]!;
        if (count === 0) { score += priority[index] ? PRIORITY_WEIGHT : 1; newCount++; }
        else score += priority[index] && count < 2 ? 0.1 : -0.3;
      }
      if (newCount > 0 && score > bestScore + 1e-9) { bestScore = score; bestIndex = i; }
    }
    if (bestIndex < 0) break;
    const position: Coordinates = [...candidates[bestIndex]!];
    used.add(`${capability.rangeMeters}:${bestIndex}`);
    counts[model.id] = counts[model.id]! - 1;
    const id = `drone-${iteration + 1}`, pilotId = `pilot-${iteration + 1}`;
    const coverage = { center: [...position] as Coordinates, radiusMeters: capability.rangeMeters!, headingDegrees: 0, workingAngleDegrees: 360 };
    const maxAltitude = capability.maxAltitudeMetersAgl[input.constraints.environment];
    const separation = input.constraints.minimumVerticalSeparationMeters;
    let altitude = 10;
    while (altitude <= maxAltitude && result.drones.some(d => coveragesOverlap(d.coverage, coverage)
      && Math.abs(d.altitudeMetersAgl - altitude) < separation)) altitude += separation;
    if (altitude > maxAltitude) {
      altitude = maxAltitude;
      result.warnings.push(`${id} : aucune altitude séparée disponible sous le plafond ${maxAltitude} m ; conflit à résoudre avant lancement.`);
    }
    result.pilots.push({ id: pilotId, name: `Télépilote ${iteration + 1}`, qualification: capability.pilotQualification, pilotPosition: [...position] });
    result.drones.push({ id, modelId: model.id, capabilityId: capability.id, pilotId, dronePosition: position,
      altitudeMetersAgl: altitude, coverage, status: 'ready' });
    result.estimate.dronesByModel[model.id]++;
    result.estimate.pilotCount++;
    for (const index of options[bestIndex]!) coverCounts[index] = coverCounts[index]! + 1;
    const covered = coverCounts.filter(c => c > 0).length;
    const priorityCount = priority.filter(Boolean).length;
    const priorityCovered = priority.filter((p, i) => p && coverCounts[i]! > 0).length;
    if (covered / grid.points.length >= 0.98 && (!priorityCount || priorityCovered / priorityCount >= 0.99)) break;
  }
  const metrics = computeCoverage(result);
  if (metrics.totalCoveragePercent < 98) result.warnings.push('Couverture partielle : moyens épuisés, gain marginal insuffisant ou quantitée de drones abérante.');
  if (input.weather.rainDetected === true) result.warnings.push('Pluie détectée : DJI Mini 5 exclus de la configuration.');
  if (input.weather.rainDetected === null) result.warnings.push('Pluie inconnue : compatibilité météo à confirmer.');
  if (result.drones.length === MAX_PLANNING_DRONES) result.warnings.push('Quantitée de drone abérante');
  if (metrics.priorityCoveragePercent === null && input.priorityZones.length) result.warnings.push('Zones prioritaires hors zone ou trop fines pour la grille ; élargir/vérifier le dessin.');
  result.estimate.assumptions = [
    'Heuristique gloutonne déterministe ; aucune optimalité mathématique revendiquée.',
    `Priorités pondérées ×${PRIORITY_WEIGHT} ; pénalité de redondance hors priorité : 0,3 par échantillon.`,
    `Rayon de simulation = portée du scénario (${selectedCapability(eligible[0]!, input.capabilityId).rangeMeters} m) ; pas un capteur constructeur.`,
    'Répartition des modèles par rotation dans l’ordre du catalogue, un télépilote proposé par drone.',
    `Grille adaptative : ${metrics.sampleCount} échantillons, espacement ~${Math.round(metrics.sampleSpacingMeters)} m.`,
    'Positions initiales drone/télépilote identiques par simplification, références distinctes.',
  ];
  return result;
}

export function estimateResources(input: PlanningInput): ResourceEstimate {
  const dronesByModel = Object.fromEntries(input.catalog.map(m => [m.id, MAX_PLANNING_DRONES])) as Record<DroneModelId, number>;
  return plan(input, { dronesByModel }).estimate;
}

export function generatePlan(input: PlanningInput): PlanningResult {
  return plan(input, input.availableResources);
}

export function computeCoverage(plan: PlanningResult): CoverageMetrics {
  return coverageMetrics(plan.operationZone.geometry, plan.priorityZones, plan.drones);
}
