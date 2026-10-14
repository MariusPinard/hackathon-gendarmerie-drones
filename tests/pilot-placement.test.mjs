import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DRONE_CATALOG } from '../src/data/droneCatalog.ts';
import { distanceM, placePilots, zoneAt } from '../src/services/pilotPlacement.ts';

const commune = JSON.parse(readFileSync(new URL('../public/occupancy/commune-09194.json', import.meta.url), 'utf-8'));
const maps = [commune.occupancy];
const model = DRONE_CATALOG[0];

function plan(centres, capabilityId = 'tp1-out-of-sight', radius = 1000) {
  return {
    missionId: 'test', estimate: { dronesByModel: {}, pilotCount: centres.length, assumptions: [] }, warnings: [],
    operationZone: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[1.86, 43.08], [1.89, 43.08], [1.89, 43.095], [1.86, 43.095], [1.86, 43.08]]] }, properties: { id: 'o', name: 'o', kind: 'operation' } },
    priorityZones: [],
    pilots: centres.map((c, i) => ({ id: `pilot-${i}`, name: `Télépilote ${i + 1}`, qualification: capabilityId.startsWith('tp2') ? 'TP2' : 'TP1', pilotPosition: [...c] })),
    drones: centres.map((c, i) => ({ id: `drone-${i}`, modelId: model.id, capabilityId, pilotId: `pilot-${i}`, dronePosition: [...c], altitudeMetersAgl: 30,
      coverage: { center: [...c], radiusMeters: radius, headingDegrees: 0, workingAngleDegrees: 360 }, status: 'ready' })),
  };
}

// Centre of the bastide (cathedral, built-up) and a point in open country north of the Hers.
const bastide = [1.8748, 43.0872];

test('a pilot on a building moves to a takeoff cell and range stays guaranteed', () => {
  assert.equal(zoneAt(maps, bastide)?.takeoff, 'impossible');
  const source = plan([bastide]);
  const before = structuredClone(source);
  const { result, sites } = placePilots(source, maps, DRONE_CATALOG);
  assert.deepEqual(source, before, 'input plan not mutated');
  const [site] = sites;
  assert.ok(!site.unresolved && site.shiftM > 0 && site.shiftM <= 250, JSON.stringify(site));
  assert.notEqual(zoneAt(maps, result.pilots[0].pilotPosition)?.takeoff, 'impossible');
  const drone = result.drones[0];
  const range = model.capabilities.find(c => c.id === drone.capabilityId).rangeMeters;
  assert.ok(distanceM(result.pilots[0].pilotPosition, drone.dronePosition) + drone.coverage.radiusMeters <= range + 1);
  assert.deepEqual(drone.dronePosition, bastide, 'the drone working area keeps its centre');
  assert.deepEqual(drone.coverage.center, drone.dronePosition);
});

test('a pilot already on a free cell does not move, outside the map it is reported unknown', () => {
  // A point well inside a « Libre » zone (not on its border).
  const [x0, y0] = commune.occupancy.zones.find(z => z.status === 'free').geometry.coordinates[0][0][0];
  let free = null;
  for (let i = -20; i <= 20 && !free; i++) for (let j = -20; j <= 20 && !free; j++) {
    const p = [x0 + i * 0.00005, y0 + j * 0.00005];
    const around = [[0, 0], [0.0002, 0], [-0.0002, 0], [0, 0.0002], [0, -0.0002]].map(([dx, dy]) => zoneAt(maps, [p[0] + dx, p[1] + dy])?.status);
    if (around.every(status => status === 'free')) free = p;
  }
  assert.ok(free, 'interior free point found');
  const { sites } = placePilots(plan([free]), maps, DRONE_CATALOG);
  assert.equal(sites[0].shiftM, 0);
  assert.equal(sites[0].verdict, 'possible');
  const outside = placePilots(plan([[2.35, 48.85]]), maps, DRONE_CATALOG).sites[0];
  assert.equal(outside.verdict, 'unknown');
  assert.equal(outside.unresolved, true);
  assert.equal(outside.shiftM, 0);
});
