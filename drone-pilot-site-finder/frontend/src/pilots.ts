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
  const sites: { position: LonLat; status: OccupancyStatus; quality: 'A' | 'B' | 'C' | null }[] = []
  for (const zone of occupancy.zones) {
    if (!statuses.includes(zone.status)) continue
    for (const polygon of polygonsOf(zone)) {
      const w = Math.max(bbox[0], polygon.bbox[0]), e = Math.min(bbox[2], polygon.bbox[2])
      const s = Math.max(bbox[1], polygon.bbox[1]), n = Math.min(bbox[3], polygon.bbox[3])
      if (w > e || s > n) continue
      // Global lattice alignment: no duplicates between neighbouring polygons.
      for (let y = Math.ceil(s / latStep) * latStep; y <= n; y += latStep) {
        for (let x = Math.ceil(w / lonStep) * lonStep; x <= e; x += lonStep) {
          if (inPolygon(x, y, polygon.rings)) sites.push({ position: [x, y], status: zone.status, quality: zone.quality ?? null })
        }
      }
    }
  }
  return sites
}

/** Closest point with takeoff « possible » (else conditional), within maxDistance metres. */
export function nearestFreeSite(occupancy: OccupancyMap, point: LonLat, maxDistanceM = 600): { position: LonLat; status: OccupancyStatus; quality: 'A' | 'B' | 'C' | null; distance: number } | null {
  const dLat = maxDistanceM / (RAD * EARTH), dLon = dLat / Math.cos(point[1] * RAD)
  const bbox: Bbox = [point[0] - dLon, point[1] - dLat, point[0] + dLon, point[1] + dLat]
  for (const statuses of [['free'], AUTO_STATUSES] as OccupancyStatus[][]) {
    let best: { position: LonLat; status: OccupancyStatus; quality: 'A' | 'B' | 'C' | null; distance: number } | null = null
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

export type PlacementMode = Qualification | 'mixed'
/** Minimum distance between two remote pilots (m). */
export const PILOT_SEPARATION_M = 50
/** A TP2 is chosen only when it covers this much more than the best TP1 (TP1 preferred). */
const TP2_ADVANTAGE = 1.5

/**
 * Greedy placement then pruning. Each new pilot goes to the free cell covering the most
 * still-uncovered points of the operation area (bonus: « libre » and quality A/B), at least
 * PILOT_SEPARATION_M from other pilots. « mixed » tries TP1 and TP2 and keeps a TP2 only when it
 * clearly saves pilots. Afterwards, any automatically placed pilot whose removal keeps the
 * coverage is removed. Existing pilots are kept. Stops at 98 % coverage or maxPilots.
 */
export function autoPlace(area: PolygonGeometry, occupancy: OccupancyMap, existing: PilotPlacement[], mode: PlacementMode, maxPilots: number) {
  const classes: Qualification[] = mode === 'mixed' ? ['TP1', 'TP2'] : [mode]
  const maxRange = Math.max(...classes.map(q => RANGE_M[q]))
  const targets = operationTargets(area)
  const ring = area.coordinates[0]!
  const lat = ring.reduce((sum, p) => sum + p[1]!, 0) / ring.length
  const dLat = maxRange / (RAD * EARTH), dLon = dLat / Math.cos(lat * RAD)
  const xs = ring.map(p => p[0]!), ys = ring.map(p => p[1]!)
  const bbox: Bbox = [Math.min(...xs) - dLon, Math.min(...ys) - dLat, Math.max(...xs) + dLon, Math.max(...ys) + dLat]
  // Cap candidates around 5000 for responsiveness.
  const extentM = Math.max((bbox[2] - bbox[0]) * Math.cos(lat * RAD), bbox[3] - bbox[1]) * RAD * EARTH
  const candidates = sampleSites(occupancy, bbox, Math.max(20, extentM / 70), AUTO_STATUSES)
  const reachOf = (position: LonLat, q: Qualification) => targets.flatMap((t, i) => distanceM(position, t) <= RANGE_M[q] ? [i] : [])
  const reach = Object.fromEntries(classes.map(q => [q, candidates.map(c => reachOf(c.position, q))])) as Record<Qualification, number[][]>
  const covered = targets.map(t => existing.some(p => distanceM(t, p.position) <= RANGE_M[p.qualification]))
  const placed: PilotPlacement[] = []
  const used = new Set<number>()
  const separated = (position: LonLat) => [...existing, ...placed].every(p => distanceM(p.position, position) >= PILOT_SEPARATION_M)
  while (placed.length < maxPilots && covered.filter(Boolean).length / targets.length < 0.98) {
    const best: Partial<Record<Qualification, { index: number; score: number; gain: number }>> = {}
    for (const q of classes) {
      candidates.forEach((candidate, i) => {
        if (used.has(i)) return
        const gain = reach[q][i]!.reduce((sum, t) => sum + (covered[t] ? 0 : 1), 0)
        if (!gain || !separated(candidate.position)) return
        const bonus = (candidate.status === 'free' ? 0.5 : 0) + (candidate.quality === 'A' ? 0.4 : candidate.quality === 'B' ? 0.2 : 0)
        const score = gain + bonus + 0.25 * reach[q][i]!.length / targets.length
        if (score > (best[q]?.score ?? 0)) best[q] = { index: i, score, gain }
      })
    }
    const pick: Qualification | null = best.TP2 && (!best.TP1 || best.TP2.gain > TP2_ADVANTAGE * best.TP1.gain) ? 'TP2' : best.TP1 ? 'TP1' : null
    if (!pick) break
    const { index } = best[pick]!
    reach[pick][index]!.forEach(t => { covered[t] = true })
    used.add(index)
    placed.push({ id: crypto.randomUUID(), name: '', qualification: pick, position: candidates[index]!.position, auto: true })
  }
  // Pruning: drop automatic pilots made redundant by later ones (greedy can over-place).
  const coveredBy = (pilots: PilotPlacement[]) => targets.filter(t => pilots.some(p => distanceM(t, p.position) <= RANGE_M[p.qualification])).length
  let kept = [...placed]
  const reference = coveredBy([...existing, ...kept])
  for (const pilot of placed) {
    const without = kept.filter(p => p !== pilot)
    if (coveredBy([...existing, ...without]) >= reference) kept = without
  }
  kept.forEach((pilot, i) => { pilot.name = `T${existing.length + i + 1}` })
  return { placed: kept, pruned: placed.length - kept.length, coverage: coveredBy([...existing, ...kept]) / targets.length, candidates: candidates.length }
}
