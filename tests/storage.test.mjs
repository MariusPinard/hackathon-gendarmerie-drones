import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { importMission, parseMission, serializeMission, validateMission, sanitizeMissionFilename, exportMission } from '../src/services/missionStorage.ts';
import { getWeather } from '../src/services/weather.ts';
import { DRONE_CATALOG } from '../src/data/droneCatalog.ts';

const example = JSON.parse(readFileSync(new URL('../src/data/exampleMission.json', import.meta.url), 'utf8'));

test('example mission survives serialization and file import without data loss', async () => {
  validateMission(example);
  const json = serializeMission(example);
  assert.deepEqual(parseMission(json), example);
  assert.deepEqual(await importMission(new Blob([json])), example);
});

const invalidCases = [
  ['unsupported version', m => { m.schemaVersion = '2.0'; }],
  ['missing operation zone', m => { delete m.operationZone; }],
  ['missing estimate', m => { delete m.estimate; }],
  ['unclosed GeoJSON ring', m => { m.operationZone.geometry.coordinates[0].pop(); }],
  ['degenerate ring', m => { m.operationZone.geometry.coordinates = [[[-1, 48], [-1, 48], [-1, 48], [-1, 48]]]; }],
  ['out of range latitude', m => { m.location = [-1, 100]; }],
  ['negative availability', m => { m.availableResources.dronesByModel['dji-mini-5'] = -1; }],
  ['fractional availability', m => { m.availableResources.dronesByModel['dji-mini-5'] = 0.5; }],
  ['unknown model', m => { m.drones[0].modelId = 'unknown'; }],
  ['unknown capability', m => { m.drones[0].capabilityId = 'unknown'; }],
  ['orphan pilot reference', m => { m.drones[0].pilotId = 'unknown'; }],
  ['duplicate drone IDs', m => { m.drones[1].id = m.drones[0].id; }],
  ['duplicate pilot IDs', m => { m.pilots[1].id = m.pilots[0].id; }],
  ['invalid status', m => { m.status = 'flying'; }],
  ['invalid drone status', m => { m.drones[0].status = 'flying'; }],
  ['missing timezone', m => { m.scheduledAt = '2026-10-15T10:00:00'; }],
  ['zero working angle', m => { m.drones[0].coverage.workingAngleDegrees = 0; }],
  ['coverage detached from drone', m => { m.drones[0].coverage.center = [0, 0]; }],
  ['non-finite altitude', m => { m.drones[0].altitudeMetersAgl = Infinity; }],
  ['separation below business rule', m => { m.constraints.minimumVerticalSeparationMeters = 9; }],
  ['calendar overflow', m => { m.scheduledAt = '2026-02-30T12:00:00Z'; }],
  ['self intersecting polygon', m => { m.operationZone.geometry.coordinates = [[[-1.7,48.1],[-1.6,48.2],[-1.7,48.2],[-1.6,48.1],[-1.7,48.1]]]; }],
  ['duplicate IDs in a large fleet', m => { m.drones = Array(33).fill(m.drones[0]); }],
  ['excessive domain', m => { m.operationZone.geometry.coordinates = [[[0,0],[2,0],[2,2],[0,2],[0,0]]]; }],
  ['unknown scenario setting', m => { m.constraints.capabilityId = 'future'; }],
  ['unavailable weather treated as dry', m => { m.weather.rainDetected = false; }],
  ['unsafe availability integer', m => { m.availableResources.dronesByModel['dji-mini-5'] = Number.MAX_SAFE_INTEGER + 1; }],
  ['unknown availability key', m => { m.availableResources.dronesByModel.other = 0; }],
  ['missing availability key', m => { delete m.availableResources.dronesByModel['dji-mini-5']; }],
  ['invalid overlap setting', m => { m.constraints.maximumOverlapPercent = 101; }],
  ['different clipping polygon', m => { m.drones[0].coverage.clipPolygon = structuredClone(m.priorityZones[0].geometry); }],
  ['clipping coordinates altered', m => { m.drones[0].coverage.clipPolygon = structuredClone(m.operationZone.geometry); m.drones[0].coverage.clipPolygon.coordinates[0][0][0] += 0.001; }],
  ['null clipping polygon', m => { m.drones[0].coverage.clipPolygon = null; }],
  ['empty custom catalog', m => { m.droneCatalog = []; }],
  ['unsafe custom catalog source', m => { m.droneCatalog = structuredClone(DRONE_CATALOG); m.droneCatalog[0].specificationSource = 'javascript:alert(1)'; }],
  ['prototype pollution extension', m => { m.extra = JSON.parse('{"__proto__":{"polluted":true}}'); }],
];

for (const [name, mutate] of invalidCases) {
  test(`rejects ${name}`, () => {
    const mission = structuredClone(example);
    mutate(mission);
    assert.throws(() => validateMission(mission), /Mission JSON invalide/);
  });
}

test('rejects malformed JSON and null root', () => {
  assert.throws(() => parseMission('{'));
  assert.throws(() => parseMission('null'), /Mission JSON invalide/);
});

test('oversized mission file is rejected before reading', async () => {
  await assert.rejects(() => importMission(new Blob([' '.repeat(2000001)])), /volumineux/);
});

test('unavailable forecast preserves unknown rain and computes local solar day', async () => {
  const weather = await getWeather(48.1173, -1.6778, '2099-01-01T12:00:00Z');
  assert.deepEqual(weather.location, example.location);
  assert.equal(weather.status, 'unavailable');
  assert.equal(weather.rainDetected, null);
  assert.equal(weather.dayNight, 'day');
});

test('legacy schema 1.0 unknown weather and safe extensions survive unchanged', () => {
  const mission = structuredClone(example);
  mission.juryAnnotations = { note: 'Champ additionnel conservé', score: 4, flags: [true, null] };
  const result = parseMission(serializeMission(mission));
  assert.deepEqual(result, mission);
  assert.equal(result.weather.dayNight, 'unknown');
  assert.equal(result.constraints.minimumVerticalSeparationMeters, 10);
  assert.equal(result.constraints.authorization, undefined);
  assert.equal(result.droneCatalog, undefined);
});

test('optional authorization reference, ceiling and offset period round-trip in schema 1.0', () => {
  const mission = structuredClone(example);
  mission.constraints.authorization = { reference: 'Arrêté — test 2026/001', maximumDrones: 3,
    startAt: '2026-10-15T08:00:00Z', endAt: '2026-10-15T13:00:00+02:00' };
  assert.deepEqual(parseMission(serializeMission(mission)), mission);
  mission.constraints.authorization.maximumDrones = 0;
  mission.constraints.authorization.endAt = '2026-10-15T10:00:00+02:00';
  // Equal UTC instants are valid even when their serialized offsets differ.
  assert.doesNotThrow(() => validateMission(mission));
});

test('authorization rejects invalid reference, numeric ceiling, calendar or period', () => {
  const valid = { reference: 'Référence déclarée', maximumDrones: 2,
    startAt: '2026-10-15T08:00:00Z', endAt: '2026-10-15T12:00:00Z' };
  for (const mutate of [
    a => { a.reference = ''; }, a => { a.reference = ' '; }, a => { a.reference = 'a'.repeat(121); },
    a => { a.maximumDrones = -1; }, a => { a.maximumDrones = Number.MAX_SAFE_INTEGER + 1; }, a => { a.maximumDrones = 1.5; },
    a => { a.maximumDrones = '2'; }, a => { a.maximumDrones = Infinity; },
    a => { a.startAt = '2026-02-30T08:00:00Z'; }, a => { a.endAt = '2026-10-15T25:00:00Z'; },
    a => { a.startAt = '2026-10-15T08:00:00'; }, a => { delete a.endAt; },
    a => { a.startAt = '2026-10-15T12:01:00Z'; },
  ]) {
    const mission = structuredClone(example), authorization = structuredClone(valid);
    mutate(authorization); mission.constraints.authorization = authorization;
    assert.throws(() => validateMission(mission), /Mission JSON invalide/);
  }
  const mission = structuredClone(example); mission.constraints.authorization = null;
  assert.throws(() => validateMission(mission), /constraints.authorization/);
});

function portableCustomMission() {
  const mission = structuredClone(example);
  const custom = { ...structuredClone(DRONE_CATALOG[0]), id: 'custom-observer', name: 'Observateur personnalisé' };
  mission.droneCatalog = [...structuredClone(DRONE_CATALOG), custom];
  mission.availableResources.dronesByModel[custom.id] = 1;
  mission.estimate = { dronesByModel: { ...mission.availableResources.dronesByModel }, pilotCount: 2, assumptions: ['Test portable'] };
  mission.drones[0].modelId = custom.id;
  mission.constraints.capabilityId = 'mixed'; mission.constraints.maximumOverlapPercent = 18;
  mission.drones[0].coverage.clipPolygon = structuredClone(mission.operationZone.geometry);
  return mission;
}

test('custom models, exact counts and operation clipping survive file round-trip', async () => {
  const mission = portableCustomMission();
  assert.deepEqual(await importMission(new Blob([serializeMission(mission)])), mission);
  // Geometry equality concerns values, not order of object properties in JSON.
  const geometry = mission.operationZone.geometry;
  mission.drones[0].coverage.clipPolygon = { coordinates: geometry.coordinates, type: 'Polygon' };
  assert.doesNotThrow(() => validateMission(mission));
});

test('embedded current and legacy in-sight ranges remain unchanged on mission round-trip', () => {
  for (const rangeMeters of [500, null]) {
    const mission = portableCustomMission();
    for (const model of mission.droneCatalog) model.capabilities.find(capability => capability.id === 'tp1-in-sight').rangeMeters = rangeMeters;
    mission.drones[0].capabilityId = 'tp1-in-sight';
    const imported = parseMission(serializeMission(mission));
    assert.deepEqual(imported, mission);
    assert.equal(imported.droneCatalog[0].capabilities.find(capability => capability.id === 'tp1-in-sight').rangeMeters, rangeMeters);
  }
});

test('custom catalog counts are exact in both availability and estimation', () => {
  for (const mutate of [
    m => { delete m.availableResources.dronesByModel['custom-observer']; },
    m => { delete m.estimate.dronesByModel['custom-observer']; },
    m => { m.estimate.dronesByModel.unknown = 0; },
    m => { m.availableResources.dronesByModel['custom-observer'] = 0.1; },
    m => { m.droneCatalog.pop(); },
  ]) { const mission = portableCustomMission(); mutate(mission); assert.throws(() => validateMission(mission), /Mission JSON invalide/); }
});

test('mission rejects inherited objects, cyclic or excessively nested extensions without crashing', () => {
  assert.throws(() => validateMission(Object.create(example)), /Mission JSON invalide/);
  const cycle = structuredClone(example); cycle.extension = cycle;
  assert.throws(() => validateMission(cycle), /cyclique/);
  const deep = structuredClone(example); let nested = deep;
  for (let depth = 0; depth < 70; depth++) { nested.extra = {}; nested = nested.extra; }
  assert.throws(() => validateMission(deep), /profonde/);
  assert.equal({}.polluted, undefined);
});

test('named exports preserve Unicode and strip paths and control characters within filename bounds', () => {
  assert.equal(sanitizeMissionFilename('  Opération à Mirepoix — été  '), 'Opération à Mirepoix — été.json');
  assert.equal(sanitizeMissionFilename('mission.JSON'), 'mission.json');
  assert.equal(sanitizeMissionFilename(''), 'mission.json');
  assert.equal(sanitizeMissionFilename('..'), 'mission.json');
  assert.equal(sanitizeMissionFilename('CON'), 'mission-CON.json');
  for (const name of ['../../répertoire/mission.json', 'C:\\répertoire\\mission.json', 'a\u0000b\n', '🚁'.repeat(500), 'x'.repeat(500)]) {
    const result = sanitizeMissionFilename(name);
    assert.ok(!/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(result));
    assert.ok(new TextEncoder().encode(result).length <= 240);
    assert.ok(result.endsWith('.json'));
  }
});

test('browser export downloads requested sanitized name and releases the temporary URL', async t => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  let clicked = false, removed = false, revoked = false;
  const link = { click: () => { clicked = true; }, remove: () => { removed = true; } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: name => { assert.equal(name, 'a'); return link; },
    body: { append: element => { assert.equal(element, link); } },
  } });
  URL.createObjectURL = blob => { assert.equal(blob.type, 'application/json'); return 'blob:test'; };
  URL.revokeObjectURL = url => { assert.equal(url, 'blob:test'); revoked = true; };
  t.after(() => { URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document; });
  exportMission(example, 'Opération été');
  assert.equal(link.download, 'Opération été.json'); assert.equal(link.href, 'blob:test');
  assert.ok(clicked && removed);
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(revoked, true);
});
