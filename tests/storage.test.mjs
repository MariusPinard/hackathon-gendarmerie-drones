import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { importMission, parseMission, serializeMission, validateMission } from '../src/services/missionStorage.ts';
import { getWeather } from '../src/services/weather.ts';

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

test('weather placeholder preserves unknown rain and day/night', async () => {
  const weather = await getWeather(48.1173, -1.6778, '2099-01-01T12:00:00Z');
  assert.deepEqual(weather.location, example.location);
  assert.equal(weather.status, 'unavailable');
  assert.equal(weather.rainDetected, null);
  assert.equal(weather.dayNight, 'unknown');
});
