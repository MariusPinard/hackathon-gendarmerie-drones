import { DRONE_CATALOG } from '../data/droneCatalog.ts';
import { validateDroneCatalog, validateJsonData } from './catalogValidation.ts';
import type { DroneModel } from '../types/drone';
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
  const calendar = new Date(0);
  calendar.setUTCFullYear(year!, month! - 1, day!);
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

function resourceCounts(value: unknown, path: string, catalog: readonly DroneModel[]): void {
  const counts = object(value, path);
  const expectedIds = new Set(catalog.map(model => model.id));
  requireValid(Object.keys(counts).length === catalog.length && Object.keys(counts).every(id => expectedIds.has(id)), path);
  for (const model of catalog) {
    requireValid(Object.hasOwn(counts, model.id), `${path}.${model.id}`);
    number(counts[model.id], `${path}.${model.id}`, 0, Number.MAX_SAFE_INTEGER);
    requireValid(Number.isSafeInteger(counts[model.id]), `${path}.${model.id}`);
  }
}

/** Structural validation; topology, coverage and operational feasibility are engine work. */
export function validateMission(value: unknown): asserts value is Mission {
  try { validateJsonData(value); } catch (error) {
    throw new Error(`Mission JSON invalide : ${error instanceof Error ? error.message : 'données invalides'}`);
  }
  const mission = object(value, 'mission');
  requireValid(mission.schemaVersion === '1.0', 'schemaVersion (1.0 attendu)');
  if (mission.droneCatalog !== undefined) {
    try { validateDroneCatalog(mission.droneCatalog); } catch (error) {
      throw new Error(`Mission JSON invalide : droneCatalog — ${error instanceof Error ? error.message : 'catalogue invalide'}`);
    }
  }
  const catalog = mission.droneCatalog as DroneModel[] | undefined ?? DRONE_CATALOG;
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
    ['mixed', 'tp1-in-sight', 'tp1-out-of-sight', 'tp2-out-of-sight'], 'constraints.capabilityId');
  if (constraints.maximumOverlapPercent !== undefined) number(constraints.maximumOverlapPercent, 'constraints.maximumOverlapPercent', 0, 100);
  if (constraints.authorization !== undefined) {
    const authorization = object(constraints.authorization, 'constraints.authorization');
    text(authorization.reference, 'constraints.authorization.reference');
    requireValid(authorization.reference.length <= 120, 'constraints.authorization.reference (maximum 120 caractères)');
    number(authorization.maximumDrones, 'constraints.authorization.maximumDrones', 0, Number.MAX_SAFE_INTEGER);
    requireValid(Number.isSafeInteger(authorization.maximumDrones), 'constraints.authorization.maximumDrones (entier attendu)');
    dateTime(authorization.startAt, 'constraints.authorization.startAt');
    dateTime(authorization.endAt, 'constraints.authorization.endAt');
    requireValid(Date.parse(authorization.startAt as string) <= Date.parse(authorization.endAt as string),
      'constraints.authorization (début après la fin)');
  }
  if (mission.estimate !== null) {
    const estimate = object(mission.estimate, 'estimate');
    resourceCounts(estimate.dronesByModel, 'estimate.dronesByModel', catalog);
    number(estimate.pilotCount, 'estimate.pilotCount');
    requireValid(Number.isSafeInteger(estimate.pilotCount), 'estimate.pilotCount');
    for (const assumption of array(estimate.assumptions, 'estimate.assumptions')) text(assumption, 'estimate.assumptions[]');
  }
  resourceCounts(object(mission.availableResources, 'availableResources').dronesByModel, 'availableResources.dronesByModel', catalog);
  const pilotIds = new Set<string>();
  const pilots = array(mission.pilots, 'pilots');
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
  for (const value of drones) {
    const drone = object(value, 'drones[]');
    text(drone.id, 'drone.id');
    requireValid(!droneIds.has(drone.id), 'drones (identifiants uniques)');
    droneIds.add(drone.id);
    const model = catalog.find(item => item.id === drone.modelId);
    requireValid(model !== undefined, 'drone.modelId');
    requireValid(model.capabilities.some(item => item.id === drone.capabilityId), 'drone.capabilityId');
    text(drone.pilotId, 'drone.pilotId');
    requireValid(pilotIds.has(drone.pilotId), 'drone.pilotId (référence inconnue)');
    coordinates(drone.dronePosition, 'drone.dronePosition');
    number(drone.altitudeMetersAgl, 'drone.altitudeMetersAgl');
    oneOf(drone.status, ['reserve', 'ready', 'active', 'unavailable', 'returning', 'emergency_landing', 'completed'], 'drone.status');
    const coverage = object(drone.coverage, 'drone.coverage');
    coordinates(coverage.center, 'drone.coverage.center');
    requireValid(JSON.stringify(coverage.center) === JSON.stringify(drone.dronePosition), 'drone.coverage.center (position du drone attendue)');
    number(coverage.radiusMeters, 'drone.coverage.radiusMeters');
    number(coverage.headingDegrees, 'drone.coverage.headingDegrees', 0, 360);
    requireValid(coverage.headingDegrees !== 360, 'drone.coverage.headingDegrees (< 360 attendu)');
    number(coverage.workingAngleDegrees, 'drone.coverage.workingAngleDegrees', Number.MIN_VALUE, 360);
    if (coverage.clipPolygon !== undefined) requireValid(equalJson(coverage.clipPolygon, object(mission.operationZone, 'operationZone').geometry), 'drone.coverage.clipPolygon (zone opération attendue)');
  }
  oneOf(mission.status, ['draft', 'planned', 'ready', 'active', 'emergency', 'returning', 'completed'], 'status');
  if (mission.emergencyRecovery !== undefined) {
    const snapshot = array(mission.emergencyRecovery, 'emergencyRecovery');
    const { emergencyRecovery: _snapshot, ...withoutSnapshot } = mission;
    void _snapshot;
    requireValid(mission.status === 'emergency', 'emergencyRecovery (mission en urgence attendue)');
    requireValid(snapshot.length === drones.length && snapshot.every((value, i) => object(value, 'emergencyRecovery[]').id === object(drones[i], 'drones[]').id), 'emergencyRecovery (flotte identique attendue)');
    validateMission({ ...withoutSnapshot, drones: snapshot, status: 'active' });
  }
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

/** Exact structural equality, independent of JSON object property order. */
function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => equalJson(value, right[index]));
  }
  const keys = Object.keys(left), rhs = right as JsonObject;
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(rhs, key) && equalJson((left as JsonObject)[key], rhs[key]));
}

/** A filename, never a path: preserve Unicode and limit the complete UTF-8 name to 240 bytes. */
export function sanitizeMissionFilename(filename: string): string {
  if (typeof filename !== 'string') throw new Error('Nom de fichier invalide.');
  const normalized = filename.normalize('NFC').trim().replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-');
  const stem = normalized.replace(/\.json$/i, '').replace(/^\.+|\.+$/g, '').trim() || 'mission';
  const chars = Array.from(stem).slice(0, 120);
  const encoder = new TextEncoder();
  while (encoder.encode(chars.join('')).length > 235) chars.pop();
  let safeStem = chars.join('').trim() || 'mission';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safeStem)) safeStem = `mission-${safeStem}`;
  // Reserved-name prefixes may add bytes; reserve room for the final suffix again.
  const safeChars = Array.from(safeStem);
  while (encoder.encode(safeChars.join('')).length > 235) safeChars.pop();
  return `${safeChars.join('')}.json`;
}

/** Browser-only download; pure serialization and parsing also work outside the UI. */
export function exportMission(mission: Mission, filename = 'mission.json'): void {
  const safeName = sanitizeMissionFilename(filename);
  const url = URL.createObjectURL(new Blob([serializeMission(mission)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = safeName;
  try { document.body.append(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
}
