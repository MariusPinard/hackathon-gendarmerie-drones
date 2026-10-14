/**
 * Takeoff occupancy map: where a remote pilot could take off, cell by cell (~10 m).
 *
 * Two sources, both optional and read-only:
 * - a precomputed commune map shipped as a static file (Mirepoix, 09194);
 * - live tiles computed by the drone-pilot-site-finder backend (`POST /api/v1/occupancy/tile`),
 *   when VITE_OCCUPANCY_API_URL is set (defaults to http://127.0.0.1:8000 in development).
 * Screening from open data only: never an authorization, the spot is checked on the ground.
 */

export type OccupancyStatus = 'free' | 'free_unconfirmed' | 'limited_range' | 'no_access' | 'masked'
  | 'out_of_range' | 'steep' | 'obstacle_buffer' | 'occupied';
export type TakeoffVerdict = 'possible' | 'conditional' | 'impossible';

export interface OccupancyZone {
  status: OccupancyStatus;
  reason: string | null;
  label: string;
  reason_label: string | null;
  takeoff: TakeoffVerdict;
  area_m2: number;
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
}

export interface OccupancyMap {
  kind: 'takeoff_occupancy';
  cell_size_m: number;
  zones: OccupancyZone[];
  assessed: Record<string, boolean>;
  notes: string[];
}

export interface CommuneOccupancy {
  kind: 'commune_takeoff_occupancy';
  commune: { name: string; insee: string; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] } };
  generated_at: string;
  occupancy: OccupancyMap;
}

export const OCCUPANCY_STYLES: Record<OccupancyStatus, { label: string; color: string }> = {
  free: { label: 'Libre', color: '#1f9d55' },
  free_unconfirmed: { label: 'Libre non confirmé', color: '#9bd36b' },
  limited_range: { label: 'Portée partielle', color: '#e2c23b' },
  no_access: { label: 'Accès éloigné', color: '#6f86b8' },
  masked: { label: 'Vue masquée', color: '#e8862e' },
  out_of_range: { label: 'Hors portée', color: '#8d5cc4' },
  steep: { label: 'Pente excessive', color: '#3d3f4a' },
  obstacle_buffer: { label: 'Marge obstacle', color: '#f08a8a' },
  occupied: { label: 'Occupée', color: '#c0392b' },
};

export const TAKEOFF_LABELS: Record<TakeoffVerdict, string> = {
  possible: 'Décollage possible', conditional: 'Sous conditions', impossible: 'Décollage impossible',
};

/** Fixed global tile grid (~800 m at Mirepoix): neighbouring tiles never overlap. */
export const TILE_LAT = 0.0072;
export const TILE_LON = 0.01;
/** Tiles queued per view, nearest to the screen centre first (one tile ≈ 10–20 s). */
export const MAX_LIVE_TILES = 24;
/** Tiles computed at the same time (public services allow a few parallel requests). */
export const LIVE_CONCURRENCY = 2;

export type TileKey = string;
export interface Tile { key: TileKey; bbox: [number, number, number, number] }

export function tilesFor(west: number, south: number, east: number, north: number): Tile[] {
  const tiles: Tile[] = [];
  for (let j = Math.floor(south / TILE_LAT); j * TILE_LAT < north; j++) {
    for (let i = Math.floor(west / TILE_LON); i * TILE_LON < east; i++) {
      const bbox: Tile['bbox'] = [i * TILE_LON, j * TILE_LAT, (i + 1) * TILE_LON, (j + 1) * TILE_LAT].map(v => Number(v.toFixed(6))) as Tile['bbox'];
      tiles.push({ key: `${i}:${j}`, bbox });
    }
  }
  return tiles;
}

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi! > y) !== (yj! > y) && x < (xj! - xi!) * (y - yi!) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}

/** True when the four tile corners fall inside the precomputed commune (no live request needed). */
export function tileCoveredBy(commune: CommuneOccupancy | null, [w, s, e, n]: Tile['bbox']): boolean {
  if (!commune) return false;
  const polygons = (commune.commune.geometry.type === 'Polygon'
    ? [commune.commune.geometry.coordinates] : commune.commune.geometry.coordinates) as number[][][][];
  return [[w, s], [e, s], [e, n], [w, n]].every(([x, y]) => polygons.some(rings => inRing(x!, y!, rings[0]!)));
}

export const PRECOMPUTED_COMMUNES = ['09194'];

export async function loadCommuneOccupancy(insee: string, signal?: AbortSignal): Promise<CommuneOccupancy> {
  const response = await fetch(`${import.meta.env.BASE_URL}occupancy/commune-${insee}.json`, { signal: signal ?? null });
  if (!response.ok) throw new Error('Carte d’occupation précalculée absente.');
  const data = await response.json() as CommuneOccupancy;
  if (data.kind !== 'commune_takeoff_occupancy' || !Array.isArray(data.occupancy?.zones)) throw new Error('Carte d’occupation précalculée incompatible.');
  return data;
}

/** Session caches shared by the map overlay and the pilot placement. */
export const occupancyTileCache = new Map<TileKey, OccupancyMap | Error>();
let precomputedCommune: Promise<CommuneOccupancy | null> | null = null;

export function getPrecomputedCommune(): Promise<CommuneOccupancy | null> {
  precomputedCommune ??= Promise.all(PRECOMPUTED_COMMUNES.map(code => loadCommuneOccupancy(code).catch(() => null))).then(list => list.find(Boolean) ?? null);
  return precomputedCommune;
}

export function occupancyApiUrl(): string | null {
  const configured = import.meta.env.VITE_OCCUPANCY_API_URL as string | undefined;
  if (configured !== undefined) return configured.trim().replace(/\/$/, '') || null;
  return import.meta.env.DEV ? 'http://127.0.0.1:8000' : null;
}

export async function fetchOccupancyTile(apiUrl: string, tile: Tile, signal?: AbortSignal): Promise<OccupancyMap> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/v1/occupancy/tile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: signal ?? null,
      body: JSON.stringify({ bbox: tile.bbox }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Service de calcul d’occupation injoignable.');
  }
  const body = await response.json().catch(() => null) as (OccupancyMap & { error?: { message?: string } }) | null;
  if (!response.ok || !body || body.kind !== 'takeoff_occupancy' || !Array.isArray(body.zones)) {
    throw new Error(body?.error?.message ?? `Calcul d’occupation impossible (${response.status}).`);
  }
  return body;
}
