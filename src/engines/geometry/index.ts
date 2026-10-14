import type { Coordinates, CoverageArea, Polygon, PriorityZone } from '../../types/geo';
import type { DroneInstance } from '../../types/drone';
import type { CoverageMetrics } from '../../types/planning';
import { distanceMeters, pointInPolygon, project, unproject, samplePolygon } from './primitives.ts';
import { intersectPolygons } from './clipping.ts';
export * from './primitives.ts';
export { intersectPolygons } from './clipping.ts';
const RAD = Math.PI / 180;

export function pointInCoverage(point: Coordinates, coverage: CoverageArea): boolean {
  if (coverage.clipPolygon && !pointInPolygon(point, coverage.clipPolygon)) return false;
  const [x, y] = project(point, coverage.center);
  if (Math.hypot(x, y) > coverage.radiusMeters + 1e-6) return false;
  if (coverage.workingAngleDegrees >= 360 || Math.hypot(x, y) < 1e-6) return true;
  const bearing = (Math.atan2(x, y) / RAD + 360) % 360;
  const difference = Math.abs(((bearing - coverage.headingDegrees + 540) % 360) - 180);
  return difference <= coverage.workingAngleDegrees / 2 + 1e-8;
}

export function coveragePolygon(coverage: CoverageArea): Polygon {
  const full = coverage.workingAngleDegrees === 360;
  const points: Coordinates[] = full ? [] : [coverage.center];
  const steps = Math.max(2, Math.ceil(coverage.workingAngleDegrees / 5));
  const start = full ? 0 : coverage.headingDegrees - coverage.workingAngleDegrees / 2;
  for (let i = 0; i < steps + (full ? 0 : 1); i++) {
    const angle = (start + coverage.workingAngleDegrees * i / steps) * RAD;
    points.push(unproject([Math.sin(angle) * coverage.radiusMeters, Math.cos(angle) * coverage.radiusMeters], coverage.center));
  }
  points.push(points[0]!);
  return { type: 'Polygon', coordinates: [points] };
}

/** Work area, clipped to the operation. An intersection can have several disconnected pieces. */
const shapeCache = new WeakMap<CoverageArea, { signature: string; mask: Polygon | undefined; polygons: Polygon[] }>();
export function coveragePolygons(coverage: CoverageArea): Polygon[] {
  if (coverage.radiusMeters <= 0) return [];
  const signature = `${coverage.center}:${coverage.radiusMeters}:${coverage.headingDegrees}:${coverage.workingAngleDegrees}`;
  const cached = shapeCache.get(coverage);
  if (cached?.signature === signature && cached.mask === coverage.clipPolygon) return cached.polygons;
  const shape = coveragePolygon(coverage);
  const polygons = coverage.clipPolygon ? intersectPolygons(shape, coverage.clipPolygon) : [shape];
  shapeCache.set(coverage, { signature, mask: coverage.clipPolygon, polygons });
  return polygons;
}

export function coveragesOverlap(a: CoverageArea, b: CoverageArea): boolean {
  if (a.radiusMeters <= 0 || b.radiusMeters <= 0) return false;
  if (distanceMeters(a.center, b.center) >= a.radiusMeters + b.radiusMeters) return false;
  if (a.workingAngleDegrees === 360 && b.workingAngleDegrees === 360 && !a.clipPolygon && !b.clipPolygon) return true;
  const piecesA = coveragePolygons(a), piecesB = coveragePolygons(b);
  for (const polygonA of piecesA) for (const polygonB of piecesB) {
    if (intersectPolygons(polygonA, polygonB).length > 0) return true;
  }
  return false;
}

export function hasCoverage(drone: DroneInstance): boolean {
  return drone.status === 'ready' || drone.status === 'active';
}

export function coverageMetrics(operation: Polygon, priorities: PriorityZone[], drones: DroneInstance[]): CoverageMetrics {
  const grid = samplePolygon(operation);
  const active = drones.filter(hasCoverage);
  // Grid points already belong to operation. Avoid repeating its potentially large mask
  // for every drone and point, while preserving distinct masks supplied by other callers.
  const operationKey = JSON.stringify(operation);
  const areas = active.map(drone => drone.coverage.clipPolygon && JSON.stringify(drone.coverage.clipPolygon) === operationKey
    ? { center: drone.coverage.center, radiusMeters: drone.coverage.radiusMeters, headingDegrees: drone.coverage.headingDegrees,
      workingAngleDegrees: drone.coverage.workingAngleDegrees } : drone.coverage);
  let covered = 0, priorityCount = 0, coveredPriority = 0, overlap = 0, overlapOutside = 0;
  const uncovered: Coordinates[] = [];
  for (const point of grid.points) {
    const priority = priorities.some(zone => pointInPolygon(point, zone.geometry));
    const count = areas.filter(area => pointInCoverage(point, area)).length;
    if (priority) priorityCount++;
    if (count > 0) { covered++; if (priority) coveredPriority++; }
    else uncovered.push(point);
    if (count > 1) { overlap++; if (!priority) overlapOutside++; }
  }
  const total = grid.points.length;
  return {
    operationAreaSquareMeters: total * grid.cellArea, coveredAreaSquareMeters: covered * grid.cellArea,
    priorityAreaSquareMeters: priorityCount * grid.cellArea, coveredPriorityAreaSquareMeters: coveredPriority * grid.cellArea,
    overlapOutsidePrioritySquareMeters: overlapOutside * grid.cellArea,
    totalCoveragePercent: covered / total * 100, priorityCoveragePercent: priorityCount ? coveredPriority / priorityCount * 100 : null,
    overlapPercent: overlap / total * 100, usedDroneCount: active.length,
    sampleCount: total, sampleSpacingMeters: grid.spacingMeters, uncoveredPoints: uncovered,
  };
}
