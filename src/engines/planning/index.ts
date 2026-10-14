import type { CoverageMetrics, PlanningInput, PlanningResult, ResourceEstimate } from '../../types/planning';
import type { DroneCapability, DroneModel, DroneModelId, AvailableResources, DroneInstance } from '../../types/drone';
import type { Coordinates, CoverageArea } from '../../types/geo';
import { coverageMetrics, samplePolygon, pointInPolygon, coveragesOverlap, validatePolygon, project, unproject, hasCoverage, snapWorkingAngle } from '../geometry/index.ts';
import { inspectAuthorization } from './authorization.ts';

const PRIORITY_WEIGHT = 4;
/** Default minimum coverage gain (points of %) for an extra drone to be worth it. */
export const MIN_GAIN_PER_DRONE = 3;
/** Coverage floors (%) always reached when means allow: whole area and priority (critical) zones. */
export const MIN_TOTAL_COVERAGE = 85;
export const MIN_PRIORITY_COVERAGE = 92;
/** Drone counts up to which every layout is fully refined (local search, k-centres). */
const REFINED_DRONES = 12;
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

interface Option { model: DroneModel; capability: DroneCapability; coverage: CoverageArea; indices: number[]; score: number; gain: number; weighted: number; overlap: number }
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
  const total = grid.points.length;
  const weightOf = (index: number) => priority[index] ? PRIORITY_WEIGHT : 1;
  let overlapCount = 0;
  const placed: Option[] = [];
  const maximumDeployments = Math.min(Object.values(counts).reduce((sum, count) => sum + count, 0), authorization.maximumDrones, total);

  /** Best working area for one profile at one centre, given the current coverage. */
  function evaluate(model: DroneModel, capability: DroneCapability, center: Coordinates, within: Sample[], thorough: boolean): Option | undefined {
    const range = capability.rangeMeters!;
    const useful = within.filter(point => coverCounts[point.index] === 0);
    if (!useful.length) return undefined;
    const envelope = angularEnvelope(useful);
    const radius = mixed ? Math.min(range, Math.max(...useful.map(point => point.distance)) + grid.spacingMeters * 0.8) : range;
    if (capability.pilotQualification === 'TP2' && radius <= 1000) return undefined;
    // Try the useful angular envelope and progressively narrower directions when overlap is constrained.
    const widths = thorough
      ? [...new Set([angleLimit, Math.min(angleLimit, envelope.angle), Math.min(angleLimit, 180), Math.min(angleLimit, 90), Math.min(angleLimit, 45)].map(snapWorkingAngle))]
      : [...new Set([angleLimit, Math.min(angleLimit, envelope.angle)].map(snapWorkingAngle))];
    const headings = [envelope.heading];
    if (thorough && (angleLimit < envelope.angle || maximumOverlap < 100)) {
      const centroid = useful.reduce((sum, point) => [sum[0] + Math.sin(point.bearing * RAD), sum[1] + Math.cos(point.bearing * RAD)] as [number, number], [0, 0] as [number, number]);
      headings.push((Math.atan2(centroid[0], centroid[1]) / RAD + 360) % 360);
      headings.push(useful.filter(point => priority[point.index])[0]?.bearing ?? useful[0]!.bearing);
    }
    let best: Option | undefined;
    for (const heading of [...new Set(headings)]) for (const angle of widths) {
      const indices: number[] = [];
      let score = 0, gain = 0, weighted = 0, addedOverlap = 0;
      for (const point of within) {
        if (point.distance > radius || (angle < 360 && Math.abs(((point.bearing - heading + 540) % 360) - 180) > angle / 2)) continue;
        indices.push(point.index);
        const count = coverCounts[point.index]!;
        if (count === 0) { gain++; weighted += weightOf(point.index); score += weightOf(point.index); }
        else { if (count === 1) addedOverlap++; score -= priority[point.index] ? 0.02 : 0.4; }
      }
      if (!gain || (overlapCount + addedOverlap) / total * 100 > maximumOverlap + 1e-8) continue;
      const proposal: Option = { model, capability, coverage: { center: [...center] as Coordinates, radiusMeters: radius, headingDegrees: heading, workingAngleDegrees: angle },
        indices, score, gain, weighted, overlap: addedOverlap };
      const equivalent = best && gain === best.gain && Math.abs(score - best.score) < 1e-8;
      if (!best || score > best.score + 1e-8 || (equivalent && capability.pilotQualification === 'TP1' && best.capability.pilotQualification === 'TP2')) best = proposal;
    }
    return best;
  }

  /** Samples within range of an arbitrary centre (candidate grid points use the cache). */
  function samplesAround(center: Coordinates, range: number): Sample[] {
    const points: Sample[] = [];
    grid.points.forEach((point, index) => {
      const [x, y] = project(point, center);
      const distance = Math.hypot(x, y);
      if (distance <= range) points.push({ index, distance, bearing: (Math.atan2(x, y) / RAD + 360) % 360 });
    });
    return points;
  }

  const add = (option: Option) => { for (const index of option.indices) { if (coverCounts[index] === 1) overlapCount++; coverCounts[index] = coverCounts[index]! + 1; } placed.push(option); counts[option.model.id] = counts[option.model.id]! - 1; };
  const remove = (option: Option) => { for (const index of option.indices) { if (coverCounts[index] === 2) overlapCount--; coverCounts[index] = coverCounts[index]! - 1; } placed.splice(placed.indexOf(option), 1); counts[option.model.id] = counts[option.model.id]! + 1; };
  // Footprints (indices) are geometric, so a snapshot restores any trial exactly.
  const snapshot = () => ({ placed: [...placed], cover: coverCounts.slice(), counts: { ...counts }, overlap: overlapCount });
  const restore = (state: ReturnType<typeof snapshot>) => { placed.splice(0, placed.length, ...state.placed); coverCounts.set(state.cover); Object.assign(counts, state.counts); overlapCount = state.overlap; };

  const covered = () => { let n = 0, w = 0, p = 0; for (let i = 0; i < total; i++) if (coverCounts[i]! > 0) { n++; w += weightOf(i); if (priority[i]) p++; } return { n, w, p }; };
  const meetsTarget = (state: { n: number; p: number }) => state.n / total >= 0.98 && (!priorityCount || state.p / priorityCount >= 0.99);
  /** Lexicographic plan quality (see below). */
  const quality = () => { const state = covered(), meets = meetsTarget(state) ? 1 : 0, tp2 = placed.filter(option => option.capability.pilotQualification === 'TP2').length;
    // Target reached: fewer drones, then fewer TP2 (TP1 preferred), more coverage, less overlap.
    // Short of target: coverage first, then fewer drones.
    return meets ? [1, -placed.length, -tp2, state.w, -overlapCount] : [0, state.w, -placed.length, -tp2, -overlapCount]; };
  const better = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) { if (a[i]! > b[i]! + 1e-9) return true; if (a[i]! < b[i]! - 1e-9) return false; } return false; };

  // Distinct geometric profiles (models sharing range, qualification and ceiling are interchangeable here;
  // standard models are rebalanced against stocks afterwards).
  const signature = (capability: DroneCapability) => `${capability.rangeMeters}:${capability.pilotQualification}:${capability.maxAltitudeMetersAgl[input.constraints.environment]}`;
  const profileFor = (capability: DroneCapability) => profiles.find(profile => signature(profile.capability) === signature(capability) && counts[profile.model.id]! > 0);
  const geometricProfiles = [...new Map(profiles.map(profile => [signature(profile.capability), profile.capability])).values()];

  /** Best single option over every candidate and geometric profile with stock left. */
  function bestAnywhere(thorough: boolean, near?: { center: Coordinates; distance: number }): Option | undefined {
    let best: Option | undefined;
    for (const capability of geometricProfiles) {
      const profile = profileFor(capability);
      if (!profile) continue;
      const cached = cache.get(capability.rangeMeters!)!;
      candidates.forEach((center, i) => {
        if (near && Math.hypot(...project(center, near.center)) > near.distance) return;
        const option = evaluate(profile.model, profile.capability, center, cached[i]!, thorough);
        const equivalent = option && best && option.gain === best.gain && Math.abs(option.score - best.score) < 1e-8;
        if (option && (!best || option.score > best.score + 1e-8 || (equivalent && option.capability.pilotQualification === 'TP1' && best.capability.pilotQualification === 'TP2'))) best = option;
      });
    }
    return best;
  }

  /** Remove-and-reinsert each drone at its best position given the others (bounded passes). */
  function relocate() {
    for (let pass = 0; pass < 4; pass++) {
      let improved = false;
      for (const option of [...placed]) {
        const before = quality(), saved = snapshot();
        remove(option);
        const candidate = bestAnywhere(false);
        if (candidate) { add(candidate); if (better(quality(), before)) { improved = true; continue; } }
        restore(saved);
      }
      if (!improved) break;
    }
  }

  /** Small shifts (half a candidate spacing) of each centre to cut overlap or gain coverage. */
  function fineTune() {
    const step = candidates.length > 1 ? Math.max(grid.spacingMeters, Math.hypot(...project(candidates[0]!, candidates[1]!)) / 2) : grid.spacingMeters;
    for (const option of [...placed]) {
      const before = quality(), saved = snapshot();
      remove(option);
      const shifts: Coordinates[] = [0, 45, 90, 135, 180, 225, 270, 315].map(angle => {
        const k = 111320, c = Math.cos(option.coverage.center[1] * RAD);
        return [option.coverage.center[0] + Math.sin(angle * RAD) * step / (k * c), option.coverage.center[1] + Math.cos(angle * RAD) * step / k] as Coordinates;
      }).filter(point => pointInPolygon(point, input.operationZone.geometry));
      const candidate = shifts.length ? evaluateAt(option, shifts) : undefined;
      if (candidate) { add(candidate); if (better(quality(), before)) continue; }
      restore(saved);
    }
  }
  function evaluateAt(option: Option, centres: Coordinates[]): Option | undefined {
    let best: Option | undefined;
    for (const center of centres) {
      const candidate = evaluate(option.model, option.capability, center, samplesAround(center, option.capability.rangeMeters!), false);
      if (candidate && (!best || candidate.score > best.score + 1e-8)) best = candidate;
    }
    return best;
  }

  /**
   * k-centre partition (farthest-first seeding, then minimax refinement): k centres minimising the
   * largest distance to the sample points. Cluster radii are capped at maxRange (partial layouts).
   */
  function kCenters(k: number, maxRange: number): { centre: Coordinates; radius: number }[] {
    const origin = grid.points[0]!;
    const xy = grid.points.map(point => project(point, origin));
    const weights = grid.points.map((_, i) => priority[i] ? 2 : 1);
    const centres: [number, number][] = [xy.reduce((best, p) => Math.hypot(p[0], p[1]) > Math.hypot(best[0], best[1]) ? p : best, xy[0]!)];
    const nearest = (p: [number, number]) => { let d = Infinity, c = 0; centres.forEach((q, j) => { const e = Math.hypot(p[0] - q[0], p[1] - q[1]); if (e < d) { d = e; c = j; } }); return { d, c }; };
    while (centres.length < k) {
      let far = xy[0]!, farDistance = -1;
      xy.forEach((p, i) => { const d = nearest(p).d * weights[i]!; if (d > farDistance) { farDistance = d; far = p; } });
      centres.push([...far]);
    }
    for (let iteration = 0; iteration < 25; iteration++) {
      const clusters = centres.map(() => [] as [number, number][]);
      xy.forEach(p => clusters[nearest(p).c]!.push(p));
      let moved = 0;
      clusters.forEach((cluster, j) => {
        if (!cluster.length) return;
        // Bădoiu–Clarkson: step toward the farthest point with decreasing steps → approximate 1-centre.
        let c: [number, number] = [cluster.reduce((s, p) => s + p[0], 0) / cluster.length, cluster.reduce((s, p) => s + p[1], 0) / cluster.length];
        for (let t = 1; t <= 60; t++) {
          let far = cluster[0]!, farDistance = -1;
          for (const p of cluster) { const d = Math.hypot(p[0] - c[0], p[1] - c[1]); if (d > farDistance) { farDistance = d; far = p; } }
          c = [c[0] + (far[0] - c[0]) / (t + 1), c[1] + (far[1] - c[1]) / (t + 1)];
        }
        moved = Math.max(moved, Math.hypot(c[0] - centres[j]![0], c[1] - centres[j]![1]));
        centres[j] = c;
      });
      if (moved < grid.spacingMeters / 4) break;
    }
    const result: { centre: Coordinates; radius: number }[] = [];
    for (const centre of centres) {
      const radius = Math.max(...xy.filter(p => nearest(p).c === centres.indexOf(centre)).map(p => Math.hypot(p[0] - centre[0], p[1] - centre[1])), 0);
      let position = unproject(centre, origin);
      // Drones start inside the operation area: snap to the closest sample point otherwise.
      if (!pointInPolygon(position, input.operationZone.geometry)) {
        let best = grid.points[0]!, bestDistance = Infinity;
        grid.points.forEach((point, i) => { const d = Math.hypot(xy[i]![0] - centre[0], xy[i]![1] - centre[1]); if (d < bestDistance) { bestDistance = d; best = point; } });
        position = [...best];
      }
      result.push({ centre: position, radius: Math.min(radius, maxRange) });
    }
    return result;
  }

  /**
   * Builds a k-drone plan from k-centre clusters: each drone covers its own cluster (radius just
   * needed, smallest profile able to do it, TP1 first), then positions are refined.
   */
  function planFrom(clusters: { centre: Coordinates; radius: number }[], fitted: boolean) {
    for (const { centre, radius } of clusters) {
      let best: Option | undefined;
      // fitted: radius just covering the cluster; otherwise the full profile range (sectors may shrink it).
      const reach = fitted ? radius + grid.spacingMeters * 0.8 : Infinity;
      for (const capability of geometricProfiles) {
        const profile = profileFor(capability);
        if (!profile || capability.rangeMeters! < Math.min(reach, capability.rangeMeters!)) continue;
        const option = evaluate(profile.model, profile.capability, centre, samplesAround(centre, Math.min(reach, capability.rangeMeters!)), true);
        const equivalent = option && best && option.gain === best.gain;
        // Prefer TP1 when it covers as much as TP2 from this centre.
        if (option && (!best || option.gain > best.gain || (equivalent && option.capability.pilotQualification === 'TP1'))) best = option;
      }
      if (best) add(best);
    }
    relocate();
    fineTune();
  }

  const empty = snapshot();
  const maxRange = Math.max(...geometricProfiles.map(capability => capability.rangeMeters!));
  const totalWeight = grid.points.reduce((sum, _, index) => sum + weightOf(index), 0);
  // An extra drone must bring MIN_GAIN points, or a quarter of what one ideal (unobstructed,
  // fully inside) disk would bring on very large areas where every drone covers only a few %.
  const idealGain = Math.PI * maxRange ** 2 / (total * grid.cellArea) * 100;
  const minimumGain = input.minimumGainPerDronePercent ?? Math.min(MIN_GAIN_PER_DRONE, idealGain / 4);
  interface Layout { drones: number; state: ReturnType<typeof snapshot>; quality: number[]; weighted: number; coverage: number; priority: number | null }
  const curve: Layout[] = [];
  // Hard floors before any trade-off: total coverage and priority (critical) coverage.
  const meetsFloors = (layout: Layout) => layout.coverage >= MIN_TOTAL_COVERAGE && (layout.priority === null || layout.priority >= MIN_PRIORITY_COVERAGE);
  const record = (): Layout => { const state = covered();
    return { drones: placed.length, state: snapshot(), quality: quality(), weighted: state.w / totalWeight * 100, coverage: state.n / total * 100,
      priority: priorityCount ? state.p / priorityCount * 100 : null }; };
  let greedyState = empty;
  // Best layout for each number of drones: greedy prefix and two k-centre layouts, all refined.
  for (let k = 1; k <= maximumDeployments; k++) {
    restore(greedyState);
    const next = bestAnywhere(true);
    if (!next) break;
    add(next);
    greedyState = snapshot();
    // Full refinement for usual sizes; very large operations keep the greedy prefix (refined below).
    const refine = k <= REFINED_DRONES;
    if (refine) { relocate(); fineTune(); }
    let best = record();
    if (refine) for (const fitted of [true, false]) {
      restore(empty);
      planFrom(kCenters(k, maxRange), fitted);
      if (placed.length === k && better(quality(), best.quality)) best = record();
    }
    curve.push(best);
    const gains = curve.slice(-3).map((layout, i, list) => i ? layout.weighted - list[i - 1]!.weighted : Infinity);
    // Stop when (almost) everything is covered or the last two drones each brought little.
    if (best.coverage >= 99.9 || (meetsFloors(best) && gains.length === 3 && gains[1]! < minimumGain && gains[2]! < minimumGain)) break;
  }
  // Hexagonal lattices (the densest disk covering of a plane), clipped to the area, for each
  // geometric profile and a few offsets: on large areas they beat any incremental layout.
  for (const capability of geometricProfiles) {
    const radius = capability.rangeMeters!, dx = Math.sqrt(3) * radius * 0.98, dy = 1.5 * radius * 0.98;
    const origin = grid.points[0]!, xy = grid.points.map(point => project(point, origin));
    const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if ((maxX - minX) * (maxY - minY) < Math.PI * radius ** 2) continue; // single-drone scale: nothing to tile
    for (const [ox, oy] of [[0, 0], [dx / 2, 0], [0, dy / 2], [dx / 2, dy / 2]] as [number, number][]) {
      restore(empty);
      for (let row = 0, y = minY - radius + oy; y <= maxY + radius; row++, y += dy) {
        for (let x = minX - radius + ox + (row % 2 ? dx / 2 : 0); x <= maxX + radius; x += dx) {
          if (!xy.some(p => Math.hypot(p[0] - x, p[1] - y) <= radius)) continue;
          let centre = unproject([x, y], origin);
          if (!pointInPolygon(centre, input.operationZone.geometry)) {
            // Drones start inside the operation area: closest sample point instead.
            let best = 0, bestDistance = Infinity;
            xy.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bestDistance) { bestDistance = d; best = i; } });
            centre = [...grid.points[best]!];
          }
          const profile = profileFor(capability);
          if (!profile || placed.length >= maximumDeployments) continue;
          const option = evaluate(profile.model, profile.capability, centre, samplesAround(centre, radius), false);
          if (option) add(option);
        }
      }
      // Used as is: small layouts are already covered by the refined greedy / k-centre curve.
      if (placed.length > REFINED_DRONES) curve.push(record());
    }
  }
  // Trade-off on the non-dominated layouts (each one covers more than any layout with fewer drones):
  // move to the layout with the best gain per extra drone while it brings at least minimumGain
  // points per drone (priority-weighted coverage).
  const byCount = [...curve].sort((a, b) => a.drones - b.drones || (better(a.quality, b.quality) ? -1 : 1));
  const front: Layout[] = [];
  for (const layout of byCount) if (!front.length || layout.weighted > front.at(-1)!.weighted + 1e-9) {
    if (front.length && front.at(-1)!.drones === layout.drones) front[front.length - 1] = layout; else front.push(layout);
  }
  // Start from the first layout meeting the floors (else the best available), then trade off.
  let chosen = front.findIndex(meetsFloors);
  if (chosen < 0) chosen = Math.max(0, front.length - 1);
  for (;;) {
    let next = -1, bestRate = -Infinity;
    for (let j = chosen + 1; j < front.length; j++) {
      const rate = (front[j]!.weighted - front[chosen]!.weighted) / (front[j]!.drones - front[chosen]!.drones);
      if (rate > bestRate + 1e-9) { bestRate = rate; next = j; }
    }
    if (next < 0 || bestRate < minimumGain) break;
    chosen = next;
  }
  if (front.length) {
    restore(front[chosen]!.state);
    if (placed.length > REFINED_DRONES) relocate();
  }
  result.tradeoff = front.map((layout, index) => ({ drones: layout.drones, coveragePercent: Number(layout.coverage.toFixed(1)),
    priorityCoveragePercent: layout.priority === null ? null : Number(layout.priority.toFixed(1)), chosen: index === chosen }));
  placed.forEach((option, iteration) => {
    const id = `drone-${iteration + 1}`, pilotId = `pilot-${iteration + 1}`, position: Coordinates = [...option.coverage.center];
    result.pilots.push({ id: pilotId, name: `Télépilote ${iteration + 1}`, qualification: option.capability.pilotQualification, pilotPosition: [...position] });
    result.drones.push({ id, modelId: option.model.id, capabilityId: option.capability.id, pilotId, dronePosition: position, altitudeMetersAgl: 10,
      coverage: { ...option.coverage, clipPolygon: structuredClone(input.operationZone.geometry) }, status: 'ready' });
  });

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
  if (metrics.totalCoveragePercent < MIN_TOTAL_COVERAGE) result.warnings.push(`Plancher non atteint : ${metrics.totalCoveragePercent.toFixed(1)} % < ${MIN_TOTAL_COVERAGE} % de couverture (stock, autorisation ou chevauchement insuffisants).`);
  if (metrics.priorityCoveragePercent !== null && metrics.priorityCoveragePercent < MIN_PRIORITY_COVERAGE) result.warnings.push(`Zones critiques sous le plancher : ${metrics.priorityCoveragePercent.toFixed(1)} % < ${MIN_PRIORITY_COVERAGE} %.`);
  const nextStep = result.tradeoff?.find((_, index, list) => index > 0 && list[index - 1]!.chosen);
  if (metrics.totalCoveragePercent < 98) result.warnings.push(nextStep
    ? `Compromis retenu : ${metrics.totalCoveragePercent.toFixed(1)} % avec ${result.drones.length} drone(s) ; ${nextStep.drones} drones donneraient ${nextStep.coveragePercent} %.`
    : 'Couverture partielle : moyens disponibles, chevauchement autorisé ou placements admissibles insuffisants.');
  if (authorization.maximumDrones === 0) result.warnings.push('Autorisation saisie : aucun drone autorisé.');
  else if (input.constraints.authorization && metrics.totalCoveragePercent < 98 && result.drones.length === authorization.maximumDrones)
    result.warnings.push(`Autorisation saisie : plafond de ${authorization.maximumDrones} drones atteint.`);
  if (authorization.outsideWindow) result.warnings.push('Hors période autorisée : ajustez la date ou l’autorisation avant lancement.');
  if (input.weather.rainDetected === true) result.warnings.push('Pluie prévue : seuls les Matrice 4T sont autorisés.');
  if (input.weather.dayNight === 'night') result.warnings.push('Mission de nuit : seuls les Matrice 4T sont autorisés.');
  if (input.weather.rainDetected === null) result.warnings.push('Pluie inconnue : compatibilité météo à confirmer.');
  if (metrics.priorityCoveragePercent === null && input.priorityZones.length) result.warnings.push('Zones prioritaires hors zone ou trop fines pour la grille ; vérifier le dessin.');
  result.estimate.assumptions = [
    `Compromis couverture / nombre de drones : meilleure disposition calculée pour 1, 2, 3… drones (glouton et partitions k-centres, puis recherche locale) ; un drone n’est ajouté que s’il apporte au moins ${minimumGain} points de couverture (priorités ×${PRIORITY_WEIGHT}). Aucun optimum mathématique garanti.`,
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
    workingAngleDegrees: snapWorkingAngle(change.workingAngleDegrees), clipPolygon: structuredClone(input.operationZone.geometry) };
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
