import type { CoverageMetrics, PlanningInput, PlanningResult, ResourceEstimate } from '../../types/planning';
import type { DroneCapability, DroneModel, DroneModelId, AvailableResources, DroneInstance } from '../../types/drone';
import type { Coordinates, CoverageArea } from '../../types/geo';
import { coverageMetrics, samplePolygon, pointInPolygon, coveragesOverlap, validatePolygon, project, hasCoverage } from '../geometry/index.ts';
import { inspectAuthorization } from './authorization.ts';

const PRIORITY_WEIGHT = 4;
const RAD = Math.PI / 180;

export function selectedCapability(model: DroneModel, capabilityId = 'tp1-out-of-sight'): DroneCapability {
  const capability = model.capabilities.find(c => c.id === capabilityId);
  if (!capability) throw new Error('Scénario de vol inconnu pour ce modèle.');
  if (capability.rangeMeters === null)
    throw new Error('La portée de ce scénario n’est pas définie dans le catalogue historique.');
  validateCapability(capability);
  return capability;
}

function validateCapability(capability: DroneCapability): void {
  const maximumRange = capability.pilotQualification === 'TP1' ? 1000 : 2000;
  if (!Number.isFinite(capability.rangeMeters) || capability.rangeMeters! <= 0 || capability.rangeMeters! > maximumRange)
    throw new Error(`Portée ${capability.pilotQualification} attendue : 1 à ${maximumRange} m.`);
  if (Object.values(capability.maxAltitudeMetersAgl).some(maximum => !Number.isFinite(maximum) || maximum < 10 || maximum > 120))
    throw new Error('Plafond du scénario attendu : 10 à 120 m.');
}

/** Operational policy is separate from manufacturers' equipment specifications. */
export function compatibleModel(model: DroneModel, weather: PlanningInput['weather']): boolean {
  if ((weather.rainDetected === true || weather.dayNight === 'night') && model.id !== 'dji-matrice-4t') return false;
  return !(model.incompatibleWithRain && weather.rainDetected === true)
    && !(model.nightCapable !== true && weather.dayNight === 'night');
}

interface Option { model: DroneModel; capability: DroneCapability; coverage: CoverageArea; indices: number[]; score: number; gain: number; overlap: number }
interface Sample { index: number; distance: number; bearing: number }

function angularEnvelope(points: Sample[]): { heading: number; angle: number } {
  if (!points.length) return { heading: 0, angle: 360 };
  const bearings = points.map(point => point.bearing).sort((a, b) => a - b);
  let gap = -1, start = 0;
  for (let i = 0; i < bearings.length; i++) {
    const next = i + 1 < bearings.length ? bearings[i + 1]! : bearings[0]! + 360;
    if (next - bearings[i]! > gap) { gap = next - bearings[i]!; start = next % 360; }
  }
  const angle = Math.min(360, Math.max(5, 360 - gap + 4));
  return { heading: (start + (360 - gap) / 2) % 360, angle };
}

function assignAltitudes(drones: DroneInstance[], catalog: readonly DroneModel[], input: PlanningInput): string[] {
  const warnings: string[] = [];
  const separation = input.constraints.minimumVerticalSeparationMeters;
  const neighbors = drones.map(() => [] as number[]);
  for (let i = 0; i < drones.length; i++) for (let j = i + 1; j < drones.length; j++)
    if (coveragesOverlap(drones[i]!.coverage, drones[j]!.coverage)) { neighbors[i]!.push(j); neighbors[j]!.push(i); }
  const ceilings = drones.map(drone => selectedCapability(catalog.find(model => model.id === drone.modelId)!, drone.capabilityId)
    .maxAltitudeMetersAgl[input.constraints.environment]);
  const levels = ceilings.map(max => Array.from({ length: Math.max(0, Math.floor((max - 10) / separation) + 1) }, (_, i) => 10 + i * separation));
  const assignments = drones.map(() => -1);
  let nodes = 0;
  const feasible = (i: number, altitude: number) => neighbors[i]!.every(j => assignments[j]! < 0 || Math.abs(assignments[j]! - altitude) >= separation);
  const nextIndex = () => drones.map((_, i) => i).filter(i => assignments[i]! < 0).sort((a, b) => {
    const saturation = (i: number) => new Set(neighbors[i]!.map(j => assignments[j]).filter(altitude => altitude! >= 0)).size;
    return saturation(b) - saturation(a) || levels[a]!.length - levels[b]!.length || neighbors[b]!.length - neighbors[a]!.length || a - b;
  })[0];
  // Bounded DSatur search accommodates different TP1/TP2 ceilings without claiming an exact solver.
  const search = (): boolean => {
    if (++nodes > 20000) return false;
    const i = nextIndex();
    if (i === undefined) return true;
    for (const altitude of levels[i]!) if (feasible(i, altitude)) {
      assignments[i] = altitude;
      if (search()) return true;
      assignments[i] = -1;
    }
    return false;
  };
  if (drones.length > 150 || !search()) {
    assignments.fill(-1);
    for (let step = 0; step < drones.length; step++) {
      const i = nextIndex()!;
      const altitude = levels[i]!.find(value => feasible(i, value));
      assignments[i] = altitude ?? ceilings[i]!;
      if (altitude === undefined) warnings.push(`${drones[i]!.id} : aucune altitude séparée trouvée sous le plafond ${ceilings[i]} m ; conflit à résoudre avant lancement.`);
    }
  }
  drones.forEach((drone, i) => { drone.altitudeMetersAgl = assignments[i]!; });
  return warnings;
}

function plan(input: PlanningInput, available: AvailableResources): PlanningResult {
  const authorization = inspectAuthorization(input.constraints, input.scheduledAt);
  const separation = input.constraints.minimumVerticalSeparationMeters;
  if (!Number.isFinite(separation) || separation < 10) throw new Error('Séparation verticale minimale : 10 m.');
  if (!['rural', 'urban'].includes(input.constraints.environment)) throw new Error('Environnement invalide.');
  const angleLimit = input.constraints.defaultWorkingAngleDegrees;
  if (!Number.isFinite(angleLimit) || angleLimit < 1 || angleLimit > 360) throw new Error('Angle de travail attendu : 1 à 360°.');
  const maximumOverlap = input.constraints.maximumOverlapPercent ?? 100;
  if (!Number.isFinite(maximumOverlap) || maximumOverlap < 0 || maximumOverlap > 100) throw new Error('Chevauchement attendu : 0 à 100 %.');
  if (input.priorityZones.length > 20) throw new Error('Maximum 20 zones prioritaires.');
  input.priorityZones.forEach(zone => validatePolygon(zone.geometry));
  if (!input.catalog.length || input.catalog.length > 50) throw new Error('Catalogue attendu : 1 à 50 modèles.');
  if (new Set(input.catalog.map(model => model.id)).size !== input.catalog.length) throw new Error('Identifiants du catalogue non uniques.');
  const eligible = input.catalog.filter(model => compatibleModel(model, input.weather));
  const mixed = (input.capabilityId ?? input.constraints.capabilityId) === 'mixed';
  const profiles = eligible.flatMap(model => (mixed
    ? model.capabilities.filter(capability => capability.flightMode === 'out_of_sight' && capability.rangeMeters !== null && capability.rangeMeters > 0
      && (capability.pilotQualification === 'TP1' || capability.rangeMeters > 1000))
    : [selectedCapability(model, input.capabilityId ?? input.constraints.capabilityId)])
    .map(capability => ({ model, capability })));
  if (!profiles.length && authorization.maximumDrones > 0) throw new Error('Aucun modèle compatible disponible pour la pluie, la nuit et le scénario choisis.');
  profiles.forEach(profile => validateCapability(profile.capability));
  const counts: Record<string, number> = {};
  for (const model of input.catalog) {
    const count = available.dronesByModel[model.id] ?? 0;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Quantité de drones invalide (entier positif ou nul).');
    counts[model.id] = count;
  }
  const grid = samplePolygon(input.operationZone.geometry);
  let candidates: Coordinates[];
  try { candidates = samplePolygon(input.operationZone.geometry, Math.max(14, Math.ceil(44 * grid.spacingMeters / Math.min(...profiles.map(profile => profile.capability.rangeMeters!), 2000)))).points; }
  catch {
    // A thin but valid operation may miss the coarse grid while the metric grid has cells.
    const stride = Math.max(1, Math.ceil(grid.points.length / 196));
    candidates = grid.points.filter((_, index) => index % stride === 0).slice(0, 196);
  }
  const priority = grid.points.map(point => input.priorityZones.some(zone => pointInPolygon(point, zone.geometry)));
  const priorityCount = priority.filter(Boolean).length;
  const coverCounts = new Uint32Array(grid.points.length);
  const samples = candidates.map(center => grid.points.map((point, index): Sample => {
    const [x, y] = project(point, center);
    return { index, distance: Math.hypot(x, y), bearing: (Math.atan2(x, y) / RAD + 360) % 360 };
  }));
  const cache = new Map<number, Sample[][]>();
  for (const { capability } of profiles) if (!cache.has(capability.rangeMeters!))
    cache.set(capability.rangeMeters!, samples.map(points => points.filter(point => point.distance <= capability.rangeMeters!)));
  const result: PlanningResult = {
    missionId: input.missionId, estimate: { dronesByModel: Object.fromEntries(input.catalog.map(model => [model.id, 0])), pilotCount: 0, assumptions: [] },
    pilots: [], drones: [], operationZone: structuredClone(input.operationZone), priorityZones: structuredClone(input.priorityZones), warnings: [],
  };
  let overlapCount = 0;
  const used = new Set<string>();
  const maximumDeployments = Math.min(Object.values(counts).reduce((sum, count) => sum + count, 0), authorization.maximumDrones, grid.points.length);
  for (let iteration = 0; iteration < maximumDeployments; iteration++) {
    let best: Option | undefined;
    for (const { model, capability } of profiles) {
      if (counts[model.id]! <= 0) continue;
      const range = capability.rangeMeters!;
      const candidateSamples = cache.get(range)!;
      for (let i = 0; i < candidates.length; i++) {
        if (used.has(`${range}:${i}`)) continue;
        const within = candidateSamples[i]!, useful = within.filter(point => coverCounts[point.index] === 0);
        if (!useful.length) continue;
        const envelope = angularEnvelope(useful);
        const radius = mixed ? Math.min(range, Math.max(...useful.map(point => point.distance)) + grid.spacingMeters * 0.8) : range;
        if (capability.pilotQualification === 'TP2' && radius <= 1000) continue;
        // Try the useful angular envelope and progressively narrower directions when overlap is constrained.
        const widths = [...new Set([angleLimit, Math.min(angleLimit, envelope.angle), Math.min(angleLimit, 180), Math.min(angleLimit, 90), Math.min(angleLimit, 45)])];
        const headings = [envelope.heading];
        if (angleLimit < envelope.angle || maximumOverlap < 100) {
          const centroid = useful.reduce((sum, point) => [sum[0] + Math.sin(point.bearing * RAD), sum[1] + Math.cos(point.bearing * RAD)] as [number, number], [0, 0] as [number, number]);
          headings.push((Math.atan2(centroid[0], centroid[1]) / RAD + 360) % 360);
          headings.push(useful.filter(point => priority[point.index])[0]?.bearing ?? useful[0]!.bearing);
        }
        for (const heading of [...new Set(headings)]) for (const angle of widths) {
          const indices: number[] = [];
          let score = 0, gain = 0, addedOverlap = 0;
          for (const point of within) {
            if (point.distance > radius || (angle < 360 && Math.abs(((point.bearing - heading + 540) % 360) - 180) > angle / 2)) continue;
            indices.push(point.index);
            const count = coverCounts[point.index]!;
            if (count === 0) { gain++; score += priority[point.index] ? PRIORITY_WEIGHT : 1; }
            else { if (count === 1) addedOverlap++; score -= priority[point.index] ? 0.02 : 0.4; }
          }
          if (!gain || (overlapCount + addedOverlap) / grid.points.length * 100 > maximumOverlap + 1e-8) continue;
          const proposal: Option = { model, capability, coverage: { center: [...candidates[i]!] as Coordinates, radiusMeters: radius,
            headingDegrees: heading, workingAngleDegrees: angle }, indices, score, gain, overlap: addedOverlap };
          const equivalent = best && gain === best.gain && Math.abs(score - best.score) < 1e-8;
          if (!best || score > best.score + 1e-8 || (equivalent && capability.pilotQualification === 'TP1' && best.capability.pilotQualification === 'TP2')) best = proposal;
        }
      }
    }
    if (!best) break;
    const { model, capability, coverage, indices } = best;
    const id = `drone-${iteration + 1}`, pilotId = `pilot-${iteration + 1}`, position: Coordinates = [...coverage.center];
    const candidateIndex = candidates.findIndex(point => point[0] === position[0] && point[1] === position[1]);
    used.add(`${capability.rangeMeters}:${candidateIndex}`);
    counts[model.id] = counts[model.id]! - 1;
    result.pilots.push({ id: pilotId, name: `Télépilote ${iteration + 1}`, qualification: capability.pilotQualification, pilotPosition: [...position] });
    result.drones.push({ id, modelId: model.id, capabilityId: capability.id, pilotId, dronePosition: position, altitudeMetersAgl: 10,
      coverage: { ...coverage, clipPolygon: structuredClone(input.operationZone.geometry) }, status: 'ready' });
    for (const index of indices) { if (coverCounts[index] === 1) overlapCount++; coverCounts[index] = coverCounts[index]! + 1; }
    const covered = coverCounts.filter(count => count > 0).length;
    const priorityCovered = priority.filter((isPriority, i) => isPriority && coverCounts[i]! > 0).length;
    if (covered / grid.points.length >= 0.98 && (!priorityCount || priorityCovered / priorityCount >= 0.99)) break;
  }
  // Preserve the coverage already obtained for partial plans; full plans retain their target.
  const baseline = coverageMetrics(input.operationZone.geometry, input.priorityZones, result.drones);
  const totalTarget = Math.min(98, baseline.totalCoveragePercent), priorityTarget = Math.min(99, baseline.priorityCoveragePercent ?? 0);
  // This is a heuristic, not an exact minimum set cover.
  for (let i = result.drones.length - 1; i >= 0; i--) {
    const remaining = result.drones.filter((_, index) => index !== i);
    const metrics = coverageMetrics(input.operationZone.geometry, input.priorityZones, remaining);
    if (metrics.totalCoveragePercent + 1e-8 >= totalTarget && (metrics.priorityCoveragePercent === null
      || metrics.priorityCoveragePercent + 1e-8 >= priorityTarget)) result.drones.splice(i, 1);
  }
  result.pilots = result.pilots.filter(pilot => result.drones.some(drone => drone.pilotId === pilot.id));
  // Reassign interchangeable standard models after removing redundant positions.
  // Geometry and qualifications stay unchanged; stock limits remain authoritative.
  const standardIds = ['dji-matrice-4t', 'dji-mavic-3-enterprise', 'dji-mini-5'];
  const standardModels = eligible.filter(model => standardIds.includes(model.id));
  const allocated: Record<string, number> = {};
  const pending: Record<string, number> = {};
  for (const drone of result.drones) pending[drone.modelId] = (pending[drone.modelId] ?? 0) + 1;
  for (const drone of result.drones) {
    if (!standardIds.includes(drone.modelId)) continue;
    pending[drone.modelId]!--;
    const original = selectedCapability(input.catalog.find(model => model.id === drone.modelId)!, drone.capabilityId);
    const choices = standardModels.filter(model => {
      const capability = model.capabilities.find(item => item.id === drone.capabilityId);
      // Keep enough of each model for later positions requiring its capabilities.
      return (allocated[model.id] ?? 0) + (pending[model.id] ?? 0) < (available.dronesByModel[model.id] ?? 0)
        && capability?.pilotQualification === original.pilotQualification
        && (capability.rangeMeters ?? 0) >= original.rangeMeters!
        && capability.maxAltitudeMetersAgl[input.constraints.environment] >= original.maxAltitudeMetersAgl[input.constraints.environment];
    }).sort((a, b) => (allocated[a.id] ?? 0) - (allocated[b.id] ?? 0) || standardIds.indexOf(a.id) - standardIds.indexOf(b.id));
    const model = choices[0];
    if (model) { drone.modelId = model.id; allocated[model.id] = (allocated[model.id] ?? 0) + 1; }
  }
  for (const drone of result.drones) result.estimate.dronesByModel[drone.modelId] = (result.estimate.dronesByModel[drone.modelId] ?? 0) + 1;
  result.estimate.pilotCount = result.drones.length;
  result.warnings.push(...assignAltitudes(result.drones.filter(hasCoverage), input.catalog, input));
  const metrics = computeCoverage(result);
  if (metrics.totalCoveragePercent < 98) result.warnings.push('Couverture partielle : moyens disponibles, chevauchement autorisé ou placements admissibles insuffisants.');
  if (authorization.maximumDrones === 0) result.warnings.push('Autorisation saisie : aucun drone autorisé.');
  else if (input.constraints.authorization && metrics.totalCoveragePercent < 98 && result.drones.length === authorization.maximumDrones)
    result.warnings.push(`Autorisation saisie : plafond de ${authorization.maximumDrones} drones atteint.`);
  if (authorization.outsideWindow) result.warnings.push('Hors période autorisée : ajustez la date ou l’autorisation avant lancement.');
  if (input.weather.rainDetected === true) result.warnings.push('Pluie prévue : seuls les Matrice 4T sont autorisés.');
  if (input.weather.dayNight === 'night') result.warnings.push('Mission de nuit : seuls les Matrice 4T sont autorisés.');
  if (input.weather.rainDetected === null) result.warnings.push('Pluie inconnue : compatibilité météo à confirmer.');
  if (metrics.priorityCoveragePercent === null && input.priorityZones.length) result.warnings.push('Zones prioritaires hors zone ou trop fines pour la grille ; vérifier le dessin.');
  result.estimate.assumptions = [
    'Heuristique gloutonne déterministe avec suppression des drones redondants ; aucun minimum mathématique garanti.',
    `Priorités pondérées ×${PRIORITY_WEIGHT} ; chevauchement autorisé : ${maximumOverlap} %.`,
    'Rayon adapté au besoin dans la limite de portée ; cap et angle ajustés ; surfaces découpées à la zone d’opération.',
    'Disques 360° évalués avant les secteurs ; modèles standard répartis équitablement selon les stocks, Matrice 4T exclusivement la nuit ou sous la pluie.',
    mixed ? 'TP1/TP2 mixtes : préférence TP1 à gain équivalent, aucun TP2 à rayon ≤ 1 km.' : 'Scénario unique conservé pour compatibilité des missions précédentes.',
    `Grille adaptative : ${metrics.sampleCount} échantillons, espacement ~${Math.round(metrics.sampleSpacingMeters)} m.`,
    'Positions initiales drone/télépilote identiques par simplification, références distinctes.',
  ];
  return result;
}

export function estimateResources(input: PlanningInput): ResourceEstimate {
  const dronesByModel = Object.fromEntries(input.catalog.map(model => [model.id, samplePolygon(input.operationZone.geometry).points.length])) as Record<DroneModelId, number>;
  return plan(input, { dronesByModel }).estimate;
}

export function generatePlan(input: PlanningInput): PlanningResult { return plan(input, input.availableResources); }

/** Edit a proposed work area without moving its drone or the other proposed positions. */
export function adjustPlanningCoverage(input: PlanningInput, source: PlanningResult, droneId: string,
  change: { headingDegrees: number; workingAngleDegrees: number; radiusMeters: number }): PlanningResult {
  if (!Number.isFinite(change.headingDegrees) || change.headingDegrees < 0 || change.headingDegrees >= 360
    || !Number.isFinite(change.workingAngleDegrees) || change.workingAngleDegrees < 1 || change.workingAngleDegrees > 360
    || !Number.isFinite(change.radiusMeters) || change.radiusMeters <= 0) throw new Error('Cap : 0–359° ; angle : 1–360° ; rayon strictement positif.');
  const result = structuredClone(source), drone = result.drones.find(item => item.id === droneId);
  if (!drone) throw new Error('Drone de la proposition inconnu.');
  const model = input.catalog.find(item => item.id === drone.modelId);
  if (!model) throw new Error('Modèle de la proposition inconnu.');
  let capability = selectedCapability(model, drone.capabilityId);
  if (change.radiusMeters > capability.rangeMeters!) {
    const mixed = (input.capabilityId ?? input.constraints.capabilityId) === 'mixed';
    const tp2 = mixed ? model.capabilities.find(item => item.pilotQualification === 'TP2' && item.flightMode === 'out_of_sight'
      && item.rangeMeters !== null && item.rangeMeters >= change.radiusMeters) : undefined;
    if (!tp2) throw new Error(`Rayon attendu : au plus ${mixed ? 2000 : capability.rangeMeters} m.`);
    validateCapability(tp2); capability = tp2;
  }
  if (capability.pilotQualification === 'TP2' && change.radiusMeters <= 1000) {
    const tp1 = model.capabilities.find(item => item.pilotQualification === 'TP1' && item.flightMode === 'out_of_sight'
      && item.rangeMeters !== null && item.rangeMeters >= change.radiusMeters);
    if (!tp1) throw new Error('Ce modèle ne propose pas de scénario TP1 pour un rayon ≤ 1 km.');
    validateCapability(tp1); capability = tp1;
  }
  drone.capabilityId = capability.id;
  const pilot = result.pilots.find(item => item.id === drone.pilotId);
  if (!pilot) throw new Error('Télépilote de la proposition inconnu.');
  pilot.qualification = capability.pilotQualification;
  drone.coverage = { center: [...drone.dronePosition], radiusMeters: change.radiusMeters, headingDegrees: change.headingDegrees,
    workingAngleDegrees: change.workingAngleDegrees, clipPolygon: structuredClone(input.operationZone.geometry) };
  result.warnings = result.warnings.filter(warning => !warning.includes('aucune altitude') && !warning.startsWith('Couverture partielle')
    && !warning.startsWith('Chevauchement '));
  result.warnings.push(...assignAltitudes(result.drones.filter(hasCoverage), input.catalog, input));
  const metrics = computeCoverage(result);
  if (metrics.totalCoveragePercent < 98) result.warnings.push('Couverture partielle après réglage : ajuster les secteurs ou les moyens.');
  if (input.constraints.maximumOverlapPercent !== undefined && metrics.overlapPercent > input.constraints.maximumOverlapPercent + 1e-6)
    result.warnings.push(`Chevauchement ${metrics.overlapPercent.toFixed(1)} % > ${input.constraints.maximumOverlapPercent} % autorisés.`);
  const authorization = inspectAuthorization(input.constraints, input.scheduledAt);
  result.warnings = result.warnings.filter(warning => !warning.startsWith('Hors période autorisée') && !warning.startsWith('Autorisation saisie'));
  if (authorization.outsideWindow) result.warnings.push('Hors période autorisée : ajustez la date ou l’autorisation avant lancement.');
  if (result.drones.length > authorization.maximumDrones) result.warnings.push(`Autorisation saisie : dispositif supérieur au plafond de ${authorization.maximumDrones} drones.`);
  return result;
}

export function computeCoverage(plan: PlanningResult): CoverageMetrics {
  return coverageMetrics(plan.operationZone.geometry, plan.priorityZones, plan.drones);
}
