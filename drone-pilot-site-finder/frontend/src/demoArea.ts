import type { PolygonGeometry } from './types'

// Example operation area: the bastide of Mirepoix (09) and its faubourgs, reference territory of
// the hackathon. It does not imply permission or suitability.
export const demoArea: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [[
    [1.8665, 43.0835], [1.8835, 43.0835], [1.8835, 43.0915], [1.8665, 43.0915], [1.8665, 43.0835],
  ]],
}

export function approximateAreaKm2(area: PolygonGeometry): number {
  // Spherical display estimate only; not used by the backend or synthetic scoring.
  const radius = 6371008.8
  const radians = Math.PI / 180
  const ringArea = (ring: number[][]) => Math.abs(ring.slice(0, -1).reduce((sum, point, index) => {
    const next = ring[index + 1]
    return sum + (next[0] - point[0]) * radians *
      (2 + Math.sin(point[1] * radians) + Math.sin(next[1] * radians))
  }, 0) * radius * radius / 2)
  return Math.max(0, ringArea(area.coordinates[0]) -
    area.coordinates.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0)) / 1_000_000
}
