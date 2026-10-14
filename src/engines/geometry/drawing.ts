import type { Coordinates, Polygon } from '../../types/geo';
import { assertCoordinates, distanceMeters, validatePolygon, samplePolygon } from './index.ts';

/** Shared by button, first-node click and double click; always returns a closed, validated ring. */
export function closeDrawnPolygon(vertices: Coordinates[]): Polygon {
  if (vertices.length < 3) throw new Error('Ajoutez au moins trois sommets avant de terminer.');
  if (vertices.length > 300) throw new Error('Maximum 300 sommets par zone.');
  vertices.forEach(assertCoordinates);
  const points = vertices.map(p => [...p] as Coordinates);
  if (points.length > 3 && distanceMeters(points[0]!, points.at(-1)!) < 0.1) points.pop();
  const polygon: Polygon = { type: 'Polygon', coordinates: [[...points, [...points[0]!] as Coordinates]] };
  validatePolygon(polygon);
  samplePolygon(polygon);
  return polygon;
}
