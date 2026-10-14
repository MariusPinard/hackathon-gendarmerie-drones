import type { PolygonGeometry } from './types'

// An arbitrary example near Fontainebleau. It does not imply permission or suitability.
export const demoArea: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [[
    [2.672, 48.401], [2.693, 48.401], [2.701, 48.411],
    [2.693, 48.423], [2.672, 48.420], [2.666, 48.410], [2.672, 48.401],
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
