/** GeoJSON order: longitude, latitude (WGS84 degrees). */
export type Coordinates = [longitude: number, latitude: number];

/** First ring is exterior; subsequent rings are holes. Rings must be closed. */
export interface Polygon {
  type: 'Polygon';
  coordinates: Coordinates[][];
}

export interface ZoneProperties {
  id: string;
  name: string;
}

export interface OperationZone {
  type: 'Feature';
  geometry: Polygon;
  properties: ZoneProperties & { kind: 'operation' };
}

export interface PriorityZone {
  type: 'Feature';
  geometry: Polygon;
  properties: ZoneProperties & { kind: 'priority' };
}

/** Coverage descriptor; the optional operation mask is part of the simulation. */
export interface CoverageArea {
  center: Coordinates;
  radiusMeters: number;
  headingDegrees: number;
  workingAngleDegrees: number;
  /** Coverage is restricted to this polygon, including its holes. Legacy files may omit it. */
  clipPolygon?: Polygon;
}
