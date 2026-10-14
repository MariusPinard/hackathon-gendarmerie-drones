/**
 * Places each remote pilot of a plan on a takeoff cell of the occupancy map.
 *
 * The planning engine puts the pilot at the centre of its drone's working area, often on a roof,
 * a road or in a wood. Here each pilot moves to the nearest cell where a takeoff is possible
 * (« Libre », else « Libre non confirmé »), within MAX_SHIFT_M. The drone keeps its working area;
 * the pilot is its takeoff point. Range stays guaranteed: when the pilot moves d metres away, the
 * working radius is reduced so that d + radius never exceeds the TP1/TP2 range.
 * Screening from open data only: the exact spot is checked on the ground.
 */
import type { Coordinates } from '../types/geo';
import type { DroneModel } from '../types/drone';
import type { PlanningResult } from '../types/planning';
import {
  fetchOccupancyTile, getPrecomputedCommune, occupancyApiUrl, occupancyTileCache, tileCoveredBy, tilesFor,
  type OccupancyMap, type OccupancyStatus, type OccupancyZone, type TakeoffVerdict,
} from './occupancy.ts';

export const MAX_SHIFT_M = 250;
const STEP_M = 10;
const EARTH = 6371008.8;
const RAD = Math.PI / 180;
/** Preferred takeoff statuses, best first. */
const TAKEOFF_STATUSES: OccupancyStatus[][] = [['free'], ['free_unconfirmed']];

export interface PilotSite {
  pilotId: string;
  verdict: TakeoffVerdict | 'unknown';
  label: string;
  reason: string | null;
  shiftM: number;
  radiusBefore: number;
  radiusAfter: number;
  /** No takeoff cell within MAX_SHIFT_M: the pilot stays at the centre, to choose on site. */
  unresolved: boolean;
}

export interface PlacementOutcome { result: PlanningResult; sites: PilotSite[]; missingData: boolean }

type Ring = number[][];
interface Indexed { rings: Ring[]; bbox: [number, number, number, number] }
const index = new WeakMap<OccupancyZone, Indexed[]>();

function polygons(zone: OccupancyZone): Indexed[] {
  let list = index.get(zone);
  if (!list) {
    list = zone.geometry.coordinates.map(rings => {
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      for (const [x, y] of rings[0]!) { w = Math.min(w, x!); e = Math.max(e, x!); s = Math.min(s, y!); n = Math.max(n, y!); }
      return { rings, bbox: [w, s, e, n] as Indexed['bbox'] };
    });
    index.set(zone, list);
  }
  return list;
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi! > y) !== (yj! > y) && x < (xj! - xi!) * (y - yi!) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}

const inPolygon = (x: number, y: number, rings: Ring[]) => inRing(x, y, rings[0]!) && !rings.slice(1).some(hole => inRing(x, y, hole));
const inBbox = (x: number, y: number, [w, s, e, n]: Indexed['bbox']) => x >= w && x <= e && y >= s && y <= n;

export function distanceM(a: Coordinates, b: Coordinates): number {
  const k = Math.cos((a[1] + b[1]) / 2 * RAD);
  return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * RAD * EARTH;
}

/** Occupancy zone under a point, or null outside every loaded map. */
export function zoneAt(maps: OccupancyMap[], [x, y]: Coordinates): OccupancyZone | null {
  for (const map of maps) for (const zone of map.zones) {
    if (polygons(zone).some(p => inBbox(x, y, p.bbox) && inPolygon(x, y, p.rings))) return zone;
  }
  return null;
}

/** Nearest lattice point (10 m) of the given statuses within maxDistance metres. */
function nearestSite(maps: OccupancyMap[], point: Coordinates, statuses: OccupancyStatus[], maxDistance: number): Coordinates | null {
  const latStep = STEP_M / (RAD * EARTH), lonStep = latStep / Math.cos(point[1] * RAD);
  const dLat = maxDistance / (RAD * EARTH), dLon = dLat / Math.cos(point[1] * RAD);
  const box: Indexed['bbox'] = [point[0] - dLon, point[1] - dLat, point[0] + dLon, point[1] + dLat];
  let best: Coordinates | null = null, bestDistance = Infinity;
  for (const map of maps) for (const zone of map.zones) {
    if (!statuses.includes(zone.status)) continue;
    for (const polygon of polygons(zone)) {
      const w = Math.max(box[0], polygon.bbox[0]), e = Math.min(box[2], polygon.bbox[2]);
      const s = Math.max(box[1], polygon.bbox[1]), n = Math.min(box[3], polygon.bbox[3]);
      if (w > e || s > n) continue;
      for (let y = Math.ceil(s / latStep) * latStep; y <= n; y += latStep) {
        for (let x = Math.ceil(w / lonStep) * lonStep; x <= e; x += lonStep) {
          const candidate: Coordinates = [x, y];
          const distance = distanceM(point, candidate);
          if (distance < bestDistance && distance <= maxDistance && inPolygon(x, y, polygon.rings)) { best = candidate; bestDistance = distance; }
        }
      }
    }
  }
  return best;
}

/**
 * Occupancy maps covering the given points: the precomputed commune, then cached or live tiles
 * (backend) for points outside it. Returns what is available; missingData tells if some points
 * could not be covered (no backend, or a tile failed).
 */
export async function occupancyAround(points: Coordinates[], signal?: AbortSignal): Promise<{ maps: OccupancyMap[]; missingData: boolean }> {
  const maps: OccupancyMap[] = [];
  const commune = await getPrecomputedCommune();
  if (commune) maps.push(commune.occupancy);
  const dLat = MAX_SHIFT_M / (RAD * EARTH);
  const needed = new Map<string, ReturnType<typeof tilesFor>[number]>();
  for (const [x, y] of points) {
    const dLon = dLat / Math.cos(y * RAD);
    for (const tile of tilesFor(x - dLon, y - dLat, x + dLon, y + dLat)) if (!tileCoveredBy(commune, tile.bbox)) needed.set(tile.key, tile);
  }
  const apiUrl = occupancyApiUrl();
  let missingData = false;
  for (const tile of needed.values()) {
    if (signal?.aborted) break;
    let cached = occupancyTileCache.get(tile.key);
    if (!cached && apiUrl) {
      try { cached = await fetchOccupancyTile(apiUrl, tile, signal); occupancyTileCache.set(tile.key, cached); }
      catch (error) { if (signal?.aborted) throw error; missingData = true; continue; }
    }
    if (cached && !(cached instanceof Error)) maps.push(cached); else missingData = true;
  }
  return { maps, missingData };
}

/** Moves pilots onto takeoff cells; pure given the maps. The input plan is not mutated. */
export function placePilots(plan: PlanningResult, maps: OccupancyMap[], catalog: readonly DroneModel[]): Omit<PlacementOutcome, 'missingData'> {
  const result = structuredClone(plan);
  const sites: PilotSite[] = [];
  for (const pilot of result.pilots) {
    const drone = result.drones.find(d => d.pilotId === pilot.id);
    if (!drone) continue;
    const range = catalog.find(m => m.id === drone.modelId)?.capabilities.find(c => c.id === drone.capabilityId)?.rangeMeters ?? null;
    const centre = drone.dronePosition;
    const radiusBefore = drone.coverage.radiusMeters;
    let position: Coordinates = [...centre];
    let zone = zoneAt(maps, centre);
    let unresolved = false;
    if (zone?.takeoff !== 'possible') {
      // Keep at least 100 m of working radius: never shift further than range − 100 m.
      const maxShift = range === null ? 0 : Math.min(MAX_SHIFT_M, Math.max(0, range - 100));
      const found = TAKEOFF_STATUSES.map(statuses => nearestSite(maps, centre, statuses, maxShift)).find(Boolean) ?? null;
      if (found && (zone?.takeoff !== 'conditional' || zoneAt(maps, found)?.takeoff === 'possible')) { position = found; zone = zoneAt(maps, found); }
      else if (!found && zone?.takeoff !== 'conditional') unresolved = true;
    }
    const shift = distanceM(centre, position);
    pilot.pilotPosition = [Number(position[0].toFixed(7)), Number(position[1].toFixed(7))];
    if (range !== null && shift + drone.coverage.radiusMeters > range) drone.coverage = { ...drone.coverage, radiusMeters: Math.max(100, Math.floor(range - shift)) };
    sites.push({
      pilotId: pilot.id, verdict: zone?.takeoff ?? 'unknown', label: zone?.label ?? 'Hors carte d’occupation', reason: zone?.reason_label ?? null,
      shiftM: Math.round(shift), radiusBefore, radiusAfter: drone.coverage.radiusMeters, unresolved,
    });
  }
  return { result, sites };
}
