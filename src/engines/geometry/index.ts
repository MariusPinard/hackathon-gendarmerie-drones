import type { Coordinates, CoverageArea, Polygon, PriorityZone } from '../../types/geo';
import type { DroneInstance } from '../../types/drone';
import type { CoverageMetrics } from '../../types/planning';

const EARTH_RADIUS = 6371008.8;
const RAD = Math.PI / 180;
export type XY = [number, number];

export function assertCoordinates(point: Coordinates): void {
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)
    || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error('Coordonnées invalides.');
}

/** Local equirectangular projection, restricted to small demonstration areas. */
export function project(point: Coordinates, origin: Coordinates): XY {
  return [(point[0] - origin[0]) * RAD * EARTH_RADIUS * Math.cos(origin[1] * RAD),
    (point[1] - origin[1]) * RAD * EARTH_RADIUS];
}

export function unproject(point: XY, origin: Coordinates): Coordinates {
  return [origin[0] + point[0] / (RAD * EARTH_RADIUS * Math.cos(origin[1] * RAD)),
    origin[1] + point[1] / (RAD * EARTH_RADIUS)];
}

export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const lat = (b[1] - a[1]) * RAD;
  const lon = (b[0] - a[0]) * RAD;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(lon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(Math.min(1, h)));
}

function onSegment(p: XY, a: XY, b: XY): boolean {
  const cross = (p[1] - a[1]) * (b[0] - a[0]) - (p[0] - a[0]) * (b[1] - a[1]);
  return Math.abs(cross) < 1e-10 && p[0] >= Math.min(a[0], b[0]) - 1e-10
    && p[0] <= Math.max(a[0], b[0]) + 1e-10 && p[1] >= Math.min(a[1], b[1]) - 1e-10
    && p[1] <= Math.max(a[1], b[1]) + 1e-10;
}

function insideRing(point: Coordinates, ring: Coordinates[]): boolean {
  let inside = false;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    if (onSegment(point, a, b)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(point: Coordinates, polygon: Polygon): boolean {
  const [outer, ...holes] = polygon.coordinates;
  return !!outer && insideRing(point, outer) && !holes.some(ring => insideRing(point, ring));
}

function cross(a: XY, b: XY, c: XY): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
  const x = cross(a, b, c), y = cross(a, b, d), z = cross(c, d, a), w = cross(c, d, b);
  return (x * y < 0 && z * w < 0) || onSegment(c, a, b) || onSegment(d, a, b)
    || onSegment(a, c, d) || onSegment(b, c, d);
}

export function validatePolygon(polygon: Polygon): void {
  if (!polygon || polygon.type !== 'Polygon' || !Array.isArray(polygon.coordinates)
    || polygon.coordinates.length < 1 || polygon.coordinates.length > 20) throw new Error('Polygone invalide.');
  for (const ring of polygon.coordinates) {
    if (!Array.isArray(ring) || ring.length < 4 || ring.length > 301) throw new Error('Un anneau doit contenir 3 à 300 sommets.');
    ring.forEach(assertCoordinates);
    const first = ring[0]!, last = ring.at(-1)!;
    if (first[0] !== last[0] || first[1] !== last[1]) throw new Error('Le polygone doit être fermé.');
    const origin = first;
    const xy = ring.map(p => project(p, origin));
    let area = 0;
    for (let i = 0; i < xy.length - 1; i++) {
      const a = xy[i]!, b = xy[i + 1]!;
      if (a[0] === b[0] && a[1] === b[1]) throw new Error('Sommets consécutifs identiques.');
      area += a[0] * b[1] - b[0] * a[1];
      for (let j = i + 2; j < xy.length - 1; j++) {
        if (i === 0 && j === xy.length - 2) continue;
        if (segmentsIntersect(a, b, xy[j]!, xy[j + 1]!)) throw new Error('Le polygone se croise lui-même.');
      }
    }
    if (Math.abs(area) < 2) throw new Error('La zone doit avoir une surface supérieure à 1 m².');
  }
  // Keep holes unambiguous: enclosed, disjoint, and not touching another ring.
  for (let i = 1; i < polygon.coordinates.length; i++) {
    const hole = polygon.coordinates[i]!;
    if (!hole.slice(0, -1).every(p => insideRing(p, polygon.coordinates[0]!))) throw new Error('Trou hors de la zone.');
    for (let j = 0; j < i; j++) {
      const other = polygon.coordinates[j]!;
      for (let a = 0; a < hole.length - 1; a++) for (let b = 0; b < other.length - 1; b++) {
        if (segmentsIntersect(hole[a]!, hole[a + 1]!, other[b]!, other[b + 1]!)) throw new Error('Anneaux en intersection.');
      }
      if (j > 0 && (insideRing(hole[0]!, other) || insideRing(other[0]!, hole))) throw new Error('Trous imbriqués.');
    }
  }
}

export function polygonBounds(polygon: Polygon) {
  const points = polygon.coordinates[0]!;
  const west = Math.min(...points.map(p => p[0])), east = Math.max(...points.map(p => p[0]));
  const south = Math.min(...points.map(p => p[1])), north = Math.max(...points.map(p => p[1]));
  return { west, east, south, north, origin: [(west + east) / 2, (south + north) / 2] as Coordinates };
}

export interface SampleGrid { points: Coordinates[]; cellArea: number; spacingMeters: number }

export function samplePolygon(polygon: Polygon, resolution = 44): SampleGrid {
  validatePolygon(polygon);
  const bounds = polygonBounds(polygon);
  if (Math.abs(bounds.origin[1]) > 75 || bounds.east - bounds.west > 180)
    throw new Error('Prototype limité aux zones locales hors régions polaires et antiméridien.');
  const min = project([bounds.west, bounds.south], bounds.origin);
  const max = project([bounds.east, bounds.north], bounds.origin);
  const width = max[0] - min[0], height = max[1] - min[1];
  if (Math.max(width, height) > 50000) throw new Error('Zone trop grande : limiter la démonstration à 50 km de côté.');
  const n = Math.max(8, Math.min(50, Math.floor(resolution)));
  const step = Math.max(width, height) / n;
  const points: Coordinates[] = [];
  for (let y = min[1] + step / 2; y < max[1]; y += step) {
    for (let x = min[0] + step / 2; x < max[0]; x += step) {
      const point = unproject([x, y], bounds.origin);
      if (pointInPolygon(point, polygon)) points.push(point);
    }
  }
  if (!points.length) throw new Error('Zone trop étroite pour la grille : élargir la zone ou découper la mission.');
  return { points, cellArea: step * step, spacingMeters: step };
}

export function pointInCoverage(point: Coordinates, coverage: CoverageArea): boolean {
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
  for (let i = 0; i <= steps; i++) {
    const angle = (start + coverage.workingAngleDegrees * i / steps) * RAD;
    points.push(unproject([Math.sin(angle) * coverage.radiusMeters, Math.cos(angle) * coverage.radiusMeters], coverage.center));
  }
  points.push(points[0]!);
  return { type: 'Polygon', coordinates: [points] };
}

export function coveragesOverlap(a: CoverageArea, b: CoverageArea): boolean {
  if (a.radiusMeters <= 0 || b.radiusMeters <= 0) return false;
  if (distanceMeters(a.center, b.center) >= a.radiusMeters + b.radiusMeters) return false;
  if (a.workingAngleDegrees === 360 && b.workingAngleDegrees === 360) return true;
  const ringA = coveragePolygon(a).coordinates[0]!, ringB = coveragePolygon(b).coordinates[0]!;
  if (ringA.some(p => pointInCoverage(p, b)) || ringB.some(p => pointInCoverage(p, a))) return true;
  for (let i = 0; i < ringA.length - 1; i++) for (let j = 0; j < ringB.length - 1; j++) {
    if (segmentsIntersect(ringA[i]!, ringA[i + 1]!, ringB[j]!, ringB[j + 1]!)) return true;
  }
  return false;
}

export function hasCoverage(drone: DroneInstance): boolean {
  return drone.status === 'ready' || drone.status === 'active';
}

export function coverageMetrics(operation: Polygon, priorities: PriorityZone[], drones: DroneInstance[]): CoverageMetrics {
  const grid = samplePolygon(operation);
  const active = drones.filter(hasCoverage);
  let covered = 0, priorityCount = 0, coveredPriority = 0, overlap = 0, overlapOutside = 0;
  const uncovered: Coordinates[] = [];
  for (const point of grid.points) {
    const priority = priorities.some(zone => pointInPolygon(point, zone.geometry));
    const count = active.filter(drone => pointInCoverage(point, drone.coverage)).length;
    if (priority) priorityCount++;
    if (count > 0) { covered++; if (priority) coveredPriority++; }
    else uncovered.push(point);
    if (count > 1) { overlap++; if (!priority) overlapOutside++; }
  }
  const total = grid.points.length;
  // A bounded, evenly distributed subset is enough for a readable map overlay.
  const stride = Math.max(1, Math.ceil(uncovered.length / 120));
  return {
    operationAreaSquareMeters: total * grid.cellArea, coveredAreaSquareMeters: covered * grid.cellArea,
    priorityAreaSquareMeters: priorityCount * grid.cellArea, coveredPriorityAreaSquareMeters: coveredPriority * grid.cellArea,
    overlapOutsidePrioritySquareMeters: overlapOutside * grid.cellArea,
    totalCoveragePercent: covered / total * 100, priorityCoveragePercent: priorityCount ? coveredPriority / priorityCount * 100 : null,
    overlapPercent: overlap / total * 100, usedDroneCount: active.length,
    sampleCount: total, sampleSpacingMeters: grid.spacingMeters, uncoveredPoints: uncovered.filter((_, i) => i % stride === 0),
  };
}
