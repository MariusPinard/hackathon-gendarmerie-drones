import { DRONE_CATALOG } from '../data/droneCatalog.ts';
import type { Mission } from '../types/mission';
import { samplePolygon, validatePolygon } from '../engines/geometry/index.ts';
import type { Polygon } from '../types/geo';

type JsonObject = Record<string, unknown>;

function requireValid(condition: boolean, path: string): asserts condition {
  if (!condition) throw new Error(`Mission JSON invalide : ${path}`);
}

function object(value: unknown, path: string): JsonObject {
  requireValid(typeof value === 'object' && value !== null && !Array.isArray(value), path);
  return value as JsonObject;
}

function array(value: unknown, path: string): unknown[] {
  requireValid(Array.isArray(value), path);
  return value;
}

function text(value: unknown, path: string): asserts value is string {
  requireValid(typeof value === 'string' && value.trim().length > 0, path);
}

function number(value: unknown, path: string, min = 0, max = Infinity): asserts value is number {
  requireValid(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, path);
}

function oneOf(value: unknown, choices: readonly string[], path: string): void {
  requireValid(typeof value === 'string' && choices.includes(value), path);
}

function dateTime(value: unknown, path: string): void {
  text(value, path);
  requireValid(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value)), path);
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year!, month! - 1, day!));
  requireValid(calendar.getUTCFullYear() === year && calendar.getUTCMonth() + 1 === month
    && calendar.getUTCDate() === day, `${path} (date calendaire invalide)`);
}

function coordinates(value: unknown, path: string): void {
  const pair = array(value, path);
  requireValid(pair.length === 2, path);
  number(pair[0], `${path}[longitude]`, -180, 180);
  number(pair[1], `${path}[latitude]`, -90, 90);
}

function zone(value: unknown, kind: 'operation' | 'priority', path: string): string {
  const feature = object(value, path);
  requireValid(feature.type === 'Feature', `${path}.type`);
  const properties = object(feature.properties, `${path}.properties`);
  text(properties.id, `${path}.properties.id`);
  text(properties.name, `${path}.properties.name`);
  requireValid(properties.kind === kind, `${path}.properties.kind`);
  const geometry = object(feature.geometry, `${path}.geometry`);
  requireValid(geometry.type === 'Polygon', `${path}.geometry.type`);
  const rings = array(geometry.coordinates, `${path}.geometry.coordinates`);
  requireValid(rings.length > 0 && rings.length <= 20, `${path}.geometry.coordinates`);
  for (const [index, value] of rings.entries()) {
    const ringPath = `${path}.geometry.coordinates[${index}]`;
    const ring = array(value, ringPath);
    requireValid(ring.length >= 4 && ring.length <= 301, ringPath);
    for (const point of ring) coordinates(point, ringPath);
    requireValid(JSON.stringify(ring[0]) === JSON.stringify(ring.at(-1)), `${ringPath} (anneau fermé)`);
    requireValid(new Set(ring.slice(0, -1).map(point => JSON.stringify(point))).size >= 3,
      `${ringPath} (trois sommets distincts)`);
  }
  try { validatePolygon(geometry as unknown as Polygon); } catch (error) {
    throw new Error(`Mission JSON invalide : ${path} — ${error instanceof Error ? error.message : 'géométrie invalide'}`);
  }
  return properties.id;
}

function resourceCounts(value: unknown, path: string): void {
  const counts = object(value, path);
  requireValid(Object.keys(counts).length === DRONE_CATALOG.length, path);
  for (const model of DRONE_CATALOG) {
    number(counts[model.id], `${path}.${model.id}`, 0, 100);
    requireValid(Number.isSafeInteger(counts[model.id]), `${path}.${model.id}`);
  }
}

/** Structural validation; topology, coverage and operational feasibility are engine work. */
export function validateMission(value: unknown): asserts value is Mission {
  const mission = object(value, 'mission');
  requireValid(mission.schemaVersion === '1.0', 'schemaVersion (1.0 attendu)');
  const metadata = object(mission.metadata, 'metadata');
  text(metadata.id, 'metadata.id');
  text(metadata.name, 'metadata.name');
  dateTime(metadata.createdAt, 'metadata.createdAt');
  dateTime(metadata.updatedAt, 'metadata.updatedAt');
  dateTime(mission.scheduledAt, 'scheduledAt');
  coordinates(mission.location, 'location');
  const zoneIds = new Set([zone(mission.operationZone, 'operation', 'operationZone')]);
  const priorities = array(mission.priorityZones, 'priorityZones');
  requireValid(priorities.length <= 20, 'priorityZones (maximum 20)');
  for (const [index, priority] of priorities.entries()) {
    const id = zone(priority, 'priority', `priorityZones[${index}]`);
    requireValid(!zoneIds.has(id), 'priorityZones (identifiants uniques)');
    zoneIds.add(id);
  }
  const weather = object(mission.weather, 'weather');
  oneOf(weather.status, ['available', 'unavailable'], 'weather.status');
  coordinates(weather.location, 'weather.location');
  dateTime(weather.dateTime, 'weather.dateTime');
  requireValid(typeof weather.rainDetected === 'boolean' || weather.rainDetected === null, 'weather.rainDetected');
  oneOf(weather.dayNight, ['day', 'night', 'unknown'], 'weather.dayNight');
  requireValid(weather.source === null || typeof weather.source === 'string', 'weather.source');
  requireValid(weather.status !== 'unavailable' || weather.rainDetected === null, 'weather (pluie inconnue si indisponible)');
  requireValid(weather.status !== 'available' || (typeof weather.rainDetected === 'boolean' && typeof weather.source === 'string' && weather.source.length > 0), 'weather (source/prévision requises)');
  const constraints = object(mission.constraints, 'constraints');
  oneOf(constraints.environment, ['rural', 'urban'], 'constraints.environment');
  number(constraints.minimumVerticalSeparationMeters, 'constraints.minimumVerticalSeparationMeters', 10);
  number(constraints.defaultWorkingAngleDegrees, 'constraints.defaultWorkingAngleDegrees', Number.MIN_VALUE, 360);
  if (constraints.capabilityId !== undefined) oneOf(constraints.capabilityId,
    ['tp1-in-sight', 'tp1-out-of-sight', 'tp2-out-of-sight'], 'constraints.capabilityId');
  if (mission.estimate !== null) {
    const estimate = object(mission.estimate, 'estimate');
    resourceCounts(estimate.dronesByModel, 'estimate.dronesByModel');
    number(estimate.pilotCount, 'estimate.pilotCount');
    requireValid(Number.isSafeInteger(estimate.pilotCount), 'estimate.pilotCount');
    for (const assumption of array(estimate.assumptions, 'estimate.assumptions')) text(assumption, 'estimate.assumptions[]');
  }
  resourceCounts(object(mission.availableResources, 'availableResources').dronesByModel, 'availableResources.dronesByModel');
  const pilotIds = new Set<string>();
  const pilots = array(mission.pilots, 'pilots');
  requireValid(pilots.length <= 100, 'pilots (maximum 100)');
  for (const value of pilots) {
    const pilot = object(value, 'pilots[]');
    text(pilot.id, 'pilot.id');
    requireValid(!pilotIds.has(pilot.id), 'pilots (identifiants uniques)');
    pilotIds.add(pilot.id);
    text(pilot.name, 'pilot.name');
    oneOf(pilot.qualification, ['TP1', 'TP2'], 'pilot.qualification');
    coordinates(pilot.pilotPosition, 'pilot.pilotPosition');
  }
  const droneIds = new Set<string>();
  const drones = array(mission.drones, 'drones');
  requireValid(drones.length <= 32, 'drones (maximum 32)');
  for (const value of drones) {
    const drone = object(value, 'drones[]');
    text(drone.id, 'drone.id');
    requireValid(!droneIds.has(drone.id), 'drones (identifiants uniques)');
    droneIds.add(drone.id);
    const model = DRONE_CATALOG.find(item => item.id === drone.modelId);
    requireValid(model !== undefined, 'drone.modelId');
    requireValid(model.capabilities.some(item => item.id === drone.capabilityId), 'drone.capabilityId');
    text(drone.pilotId, 'drone.pilotId');
    requireValid(pilotIds.has(drone.pilotId), 'drone.pilotId (référence inconnue)');
    coordinates(drone.dronePosition, 'drone.dronePosition');
    number(drone.altitudeMetersAgl, 'drone.altitudeMetersAgl');
    oneOf(drone.status, ['ready', 'active', 'unavailable', 'returning', 'emergency_landing', 'completed'], 'drone.status');
    const coverage = object(drone.coverage, 'drone.coverage');
    coordinates(coverage.center, 'drone.coverage.center');
    requireValid(JSON.stringify(coverage.center) === JSON.stringify(drone.dronePosition), 'drone.coverage.center (position du drone attendue)');
    number(coverage.radiusMeters, 'drone.coverage.radiusMeters');
    number(coverage.headingDegrees, 'drone.coverage.headingDegrees', 0, 360);
    requireValid(coverage.headingDegrees !== 360, 'drone.coverage.headingDegrees (< 360 attendu)');
    number(coverage.workingAngleDegrees, 'drone.coverage.workingAngleDegrees', Number.MIN_VALUE, 360);
  }
  oneOf(mission.status, ['draft', 'planned', 'ready', 'active', 'emergency', 'returning', 'completed'], 'status');
  try { samplePolygon((mission.operationZone as Mission['operationZone']).geometry); }
  catch (error) { throw new Error(`Mission JSON invalide : ${error instanceof Error ? error.message : 'zone invalide'}`); }
}

export function serializeMission(mission: Mission): string {
  validateMission(mission);
  return JSON.stringify(mission, null, 2);
}

export function parseMission(json: string): Mission {
  if (json.length > 2000000) throw new Error('JSON trop volumineux (maximum 2 Mo).');
  const value: unknown = JSON.parse(json);
  validateMission(value);
  return value;
}

export async function importMission(file: Blob): Promise<Mission> {
  if (file.size > 2000000) throw new Error('Fichier trop volumineux (maximum 2 Mo).');
  return parseMission(await file.text());
}

/** Browser-only download; pure serialization and parsing also work outside the UI. */
export function exportMission(mission: Mission): void {
  const url = URL.createObjectURL(new Blob([serializeMission(mission)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mission.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
