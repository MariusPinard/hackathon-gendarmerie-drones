import type { Coordinates, Polygon } from '../../types/geo';
import { pointInPolygon, polygonBounds, project, unproject, type XY } from './primitives.ts';

const EPS = 1e-6;
const cross = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0];
const subtract = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const interpolate = (a: XY, b: XY, t: number): XY => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const key = (p: XY) => `${Math.round(p[0] * 10000)},${Math.round(p[1] * 10000)}`;
const signedArea = (ring: XY[]) => ring.slice(0, -1).reduce((sum, p, i) => sum + cross(p, ring[i + 1]!), 0) / 2;

interface Edge { a: XY; b: XY; cuts: number[] }

function edges(polygon: Polygon, origin: Coordinates): Edge[] {
  return polygon.coordinates.flatMap((points, index) => {
    const ring = points.map(p => project(p, origin));
    if ((signedArea(ring) > 0) !== (index === 0)) ring.reverse();
    return ring.slice(0, -1).map((a, i) => ({ a, b: ring[i + 1]!, cuts: [0, 1] }));
  });
}

function addCut(edge: Edge, t: number): void {
  if (t >= -EPS && t <= 1 + EPS) edge.cuts.push(Math.max(0, Math.min(1, t)));
}

function splitAtIntersections(a: Edge, b: Edge): void {
  const r = subtract(a.b, a.a), s = subtract(b.b, b.a), delta = subtract(b.a, a.a);
  const denominator = cross(r, s);
  if (Math.abs(denominator) > EPS) {
    const t = cross(delta, s) / denominator, u = cross(delta, r) / denominator;
    if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) { addCut(a, t); addCut(b, u); }
  } else if (Math.abs(cross(delta, r)) <= EPS) {
    const axis = Math.abs(r[0]) >= Math.abs(r[1]) ? 0 : 1;
    if (Math.abs(r[axis]!) <= EPS || Math.abs(s[axis]!) <= EPS) return;
    addCut(a, (b.a[axis]! - a.a[axis]!) / r[axis]!);
    addCut(a, (b.b[axis]! - a.a[axis]!) / r[axis]!);
    addCut(b, (a.a[axis]! - b.a[axis]!) / s[axis]!);
    addCut(b, (a.b[axis]! - b.a[axis]!) / s[axis]!);
  }
}

/** Split a closed outline at exact operation edges; retain exterior arcs, including holes. */
export function outsidePolyline(points: Coordinates[], operation: Polygon): Coordinates[][] {
  const origin = polygonBounds(operation).origin;
  const boundary = edges(operation, origin);
  const segments = points.slice(0, -1).map((point, i): Edge => ({
    a: project(point, origin), b: project(points[i + 1]!, origin), cuts: [0, 1],
  }));
  const paths: Coordinates[][] = [];
  let path: Coordinates[] = [];
  for (const segment of segments) {
    for (const edge of boundary) splitAtIntersections(segment, edge);
    const cuts = [...new Set(segment.cuts)].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const start = cuts[i - 1]!, end = cuts[i]!;
      if (end - start < EPS) continue;
      if (!pointInPolygon(unproject(interpolate(segment.a, segment.b, (start + end) / 2), origin), operation)) {
        if (!path.length) path.push(unproject(interpolate(segment.a, segment.b, start), origin));
        path.push(unproject(interpolate(segment.a, segment.b, end), origin));
      } else if (path.length) { paths.push(path); path = []; }
    }
  }
  if (path.length) paths.push(path);
  return paths;
}

export function outsidePolygonOutline(outline: Polygon, operation: Polygon): Coordinates[][] {
  return outsidePolyline(outline.coordinates[0]!, operation);
}

/** Boundary intersection in a local metric projection. Supports concave exteriors and disjoint holes.
 * No raster approximation is used for the displayed work areas; sampled coverage metrics stay separate.
 */
export function intersectPolygons(first: Polygon, second: Polygon): Polygon[] {
  const origin = polygonBounds(first).origin;
  const firstEdges = edges(first, origin), secondEdges = edges(second, origin);
  for (const a of firstEdges) for (const b of secondEdges) splitAtIntersections(a, b);
  const kept = new Map<string, { a: XY; b: XY }>();
  for (const [source, other, otherEdges] of [[firstEdges, second, secondEdges], [secondEdges, first, firstEdges]] as const) for (const edge of source) {
    const cuts = [...new Set(edge.cuts)].sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const start = cuts[i]!, end = cuts[i + 1]!;
      if (end - start < EPS) continue;
      const midpoint = interpolate(edge.a, edge.b, (start + end) / 2);
      const onBoundary = () => otherEdges.some(candidate => {
        const direction = subtract(candidate.b, candidate.a), delta = subtract(midpoint, candidate.a);
        return Math.abs(cross(direction, delta)) <= EPS * Math.max(1, Math.hypot(...direction))
          && midpoint[0] >= Math.min(candidate.a[0], candidate.b[0]) - EPS && midpoint[0] <= Math.max(candidate.a[0], candidate.b[0]) + EPS
          && midpoint[1] >= Math.min(candidate.a[1], candidate.b[1]) - EPS && midpoint[1] <= Math.max(candidate.a[1], candidate.b[1]) + EPS;
      });
      // Coincident hole boundaries also belong to the intersection boundary.
      if (!pointInPolygon(unproject(midpoint, origin), other) && !onBoundary()) continue;
      const a = interpolate(edge.a, edge.b, start), b = interpolate(edge.a, edge.b, end);
      const forward = `${key(a)}>${key(b)}`, reverse = `${key(b)}>${key(a)}`;
      if (kept.has(reverse)) kept.delete(reverse); else kept.set(forward, { a, b });
    }
  }
  const remaining = new Set(kept.values());
  const outgoing = new Map<string, Array<{ a: XY; b: XY }>>();
  for (const edge of remaining) { const entry = outgoing.get(key(edge.a)) ?? []; entry.push(edge); outgoing.set(key(edge.a), entry); }
  const rings: XY[][] = [];
  while (remaining.size) {
    let edge = remaining.values().next().value!;
    const start = key(edge.a), ring: XY[] = [edge.a];
    for (let step = 0; step <= kept.size; step++) {
      remaining.delete(edge); ring.push(edge.b);
      if (key(edge.b) === start) { ring[ring.length - 1] = ring[0]!; if (Math.abs(signedArea(ring)) > 0.01) rings.push(ring); break; }
      const choices = (outgoing.get(key(edge.b)) ?? []).filter(candidate => remaining.has(candidate));
      if (!choices.length) break;
      const direction = subtract(edge.b, edge.a);
      choices.sort((a, b) => {
        const angle = (candidate: { a: XY; b: XY }) => {
          const next = subtract(candidate.b, candidate.a);
          return Math.atan2(cross(direction, next), direction[0] * next[0] + direction[1] * next[1]);
        };
        return angle(a) - angle(b);
      });
      edge = choices[0]!;
    }
  }
  const polygons = rings.filter(ring => signedArea(ring) > 0).map(ring => ({ type: 'Polygon' as const, coordinates: [ring.map(p => unproject(p, origin))] }));
  for (const hole of rings.filter(ring => signedArea(ring) < 0)) {
    const points = hole.map(p => unproject(p, origin));
    const parent = polygons.find(polygon => pointInPolygon(points[0]!, polygon));
    if (parent) parent.coordinates.push(points);
  }
  return polygons;
}
