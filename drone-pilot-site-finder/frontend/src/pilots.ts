import type { OccupancyMap, OccupancyStatus, OccupancyZone, PolygonGeometry, TakeoffVerdict } from './types'

/** Remote pilot placement on the occupancy map. Screening only: the spot is checked on the ground. */
export type Qualification = 'TP1' | 'TP2'
export type LonLat = [number, number]
export const RANGE_M: Record<Qualification, number> = { TP1: 1000, TP2: 2000 }

export interface PilotPlacement {
  id: string
  name: string
  qualification: Qualification
  position: LonLat
  auto?: boolean
}

export interface SiteCheck { verdict: TakeoffVerdict | 'unknown'; zone: OccupancyZone | null }

/** Statuses where the automatic placement may put a pilot (accessible, no known occupation). */
export const AUTO_STATUSES: OccupancyStatus[] = ['free', 'free_unconfirmed']

const EARTH = 6371008.8
const RAD = Math.PI / 180
type Ring = number[][]
type Bbox = [number, number, number, number]
interface IndexedPolygon { rings: Ring[]; bbox: Bbox }

const index = new WeakMap<OccupancyZone, IndexedPolygon[]>()

function polygonsOf(zone: OccupancyZone): IndexedPolygon[] {
  let polygons = index.get(zone)
  if (!polygons) {
    polygons = zone.geometry.coordinates.map(rings => {
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
      for (const [x, y] of rings[0]!) { w = Math.min(w, x!); e = Math.max(e, x!); s = Math.min(s, y!); n = Math.max(n, y!) }
      return { rings, bbox: [w, s, e, n] as Bbox }
    })
    index.set(zone, polygons)
  }
  return polygons
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!
    if ((yi! > y) !== (yj! > y) && x < (xj! - xi!) * (y - yi!) / (yj! - yi!) + xi!) inside = !inside
  }
  return inside
}

export function inPolygon(x: number, y: number, rings: Ring[]): boolean {
  return inRing(x, y, rings[0]!) && !rings.slice(1).some(hole => inRing(x, y, hole))
}

const inBbox = (x: number, y: number, [w, s, e, n]: Bbox) => x >= w && x <= e && y >= s && y <= n

/** Occupancy status under a point; « unknown » outside the computed map. */
export function siteAt(occupancy: OccupancyMap | null, [x, y]: LonLat): SiteCheck {
  for (const zone of occupancy?.zones ?? []) {
    if (polygonsOf(zone).some(p => inBbox(x, y, p.bbox) && inPolygon(x, y, p.rings))) return { verdict: zone.takeoff, zone }
  }
  return { verdict: 'unknown', zone: null }
}

export function distanceM(a: LonLat, b: LonLat): number {
  const k = Math.cos((a[1] + b[1]) / 2 * RAD)
  return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * RAD * EARTH
}

/** Points on a regular lattice (step in metres) inside the zones of the given statuses and bbox. */
export function sampleSites(occupancy: OccupancyMap, bbox: Bbox, stepM: number, statuses: OccupancyStatus[]) {
  const latStep = stepM / (RAD * EARTH)
  const lonStep = latStep / Math.cos((bbox[1] + bbox[3]) / 2 * RAD)
  const sites: { position: LonLat; status: OccupancyStatus }[] = []
  for (const zone of occupancy.zones) {
    if (!statuses.includes(zone.status)) continue
    for (const polygon of polygonsOf(zone)) {
      const w = Math.max(bbox[0], polygon.bbox[0]), e = Math.min(bbox[2], polygon.bbox[2])
      const s = Math.max(bbox[1], polygon.bbox[1]), n = Math.min(bbox[3], polygon.bbox[3])
      if (w > e || s > n) continue
      // Global lattice alignment: no duplicates between neighbouring polygons.
      for (let y = Math.ceil(s / latStep) * latStep; y <= n; y += latStep) {
        for (let x = Math.ceil(w / lonStep) * lonStep; x <= e; x += lonStep) {
          if (inPolygon(x, y, polygon.rings)) sites.push({ position: [x, y], status: zone.status })
        }
      }
    }
  }
  return sites
}

/** Closest point with takeoff « possible » (else conditional), within maxDistance metres. */
export function nearestFreeSite(occupancy: OccupancyMap, point: LonLat, maxDistanceM = 600): { position: LonLat; status: OccupancyStatus; distance: number } | null {
  const dLat = maxDistanceM / (RAD * EARTH), dLon = dLat / Math.cos(point[1] * RAD)
  const bbox: Bbox = [point[0] - dLon, point[1] - dLat, point[0] + dLon, point[1] + dLat]
  for (const statuses of [['free'], AUTO_STATUSES] as OccupancyStatus[][]) {
    let best: { position: LonLat; status: OccupancyStatus; distance: number } | null = null
    for (const site of sampleSites(occupancy, bbox, 5, statuses)) {
      const distance = distanceM(point, site.position)
      if (distance <= maxDistanceM && (!best || distance < best.distance)) best = { ...site, distance }
    }
    if (best) return best
  }
  return null
}

/** Sample points of the operation area (~600), used to measure coverage. */
export function operationTargets(area: PolygonGeometry, count = 600): LonLat[] {
  const ring = area.coordinates[0]!
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const [x, y] of ring) { w = Math.min(w, x!); e = Math.max(e, x!); s = Math.min(s, y!); n = Math.max(n, y!) }
  const k = Math.cos((s + n) / 2 * RAD)
  const areaDeg2 = Math.abs(ring.reduce((sum, [x, y], i) => { const [x2, y2] = ring[(i + 1) % ring.length]!; return sum + x! * y2! - x2! * y! }, 0)) / 2
  const latStep = Math.max(1e-6, Math.sqrt(areaDeg2 * k / count))
  const lonStep = latStep / k
  const targets: LonLat[] = []
  for (let y = s + latStep / 2; y < n; y += latStep) for (let x = w + lonStep / 2; x < e; x += lonStep) {
    if (inPolygon(x, y, area.coordinates)) targets.push([x, y])
  }
  return targets.length ? targets : [ring[0] as LonLat]
}

export function coverage(targets: LonLat[], pilots: PilotPlacement[]): number {
  if (!targets.length) return 0
  return targets.filter(t => pilots.some(p => distanceM(t, p.position) <= RANGE_M[p.qualification])).length / targets.length
}

/**
 * Greedy placement: each new pilot goes to the free cell covering the most still-uncovered points
 * of the operation area (ties: « libre » before « libre non confirmé », then closer to the area).
 * Existing pilots are kept. Stops at 98 % coverage, maxPilots, or when no cell adds coverage.
 */
export function autoPlace(area: PolygonGeometry, occupancy: OccupancyMap, existing: PilotPlacement[], qualification: Qualification, maxPilots: number) {
  const range = RANGE_M[qualification]
  const targets = operationTargets(area)
  const ring = area.coordinates[0]!
  const lat = ring.reduce((sum, p) => sum + p[1]!, 0) / ring.length
  const dLat = range / (RAD * EARTH), dLon = dLat / Math.cos(lat * RAD)
  const xs = ring.map(p => p[0]!), ys = ring.map(p => p[1]!)
  const bbox: Bbox = [Math.min(...xs) - dLon, Math.min(...ys) - dLat, Math.max(...xs) + dLon, Math.max(...ys) + dLat]
  // Cap candidates around 4000 for responsiveness.
  const extentM = Math.max((bbox[2] - bbox[0]) * Math.cos(lat * RAD), bbox[3] - bbox[1]) * RAD * EARTH
  let candidates = sampleSites(occupancy, bbox, Math.max(20, extentM / 70), AUTO_STATUSES)
  const covered = targets.map(t => existing.some(p => distanceM(t, p.position) <= RANGE_M[p.qualification]))
  const reach = candidates.map(c => targets.flatMap((t, i) => distanceM(c.position, t) <= range ? [i] : []))
  const placed: PilotPlacement[] = []
  const start = existing.length
  while (placed.length < maxPilots && covered.filter(Boolean).length / targets.length < 0.98) {
    let best = -1, bestScore = 0
    candidates.forEach((candidate, i) => {
      const gain = reach[i]!.reduce((sum, t) => sum + (covered[t] ? 0 : 1), 0)
      if (!gain) return
      const score = gain + (candidate.status === 'free' ? 0.5 : 0) + 0.25 * reach[i]!.length / targets.length
      if (score > bestScore) { bestScore = score; best = i }
    })
    if (best < 0) break
    reach[best]!.forEach(t => { covered[t] = true })
    placed.push({ id: crypto.randomUUID(), name: `T${start + placed.length + 1}`, qualification, position: candidates[best]!.position, auto: true })
    candidates = candidates.map((c, i) => i === best ? { ...c, status: 'occupied' as OccupancyStatus } : c)
    reach[best] = []
  }
  return { placed, coverage: covered.filter(Boolean).length / targets.length, candidates: candidates.length }
}
