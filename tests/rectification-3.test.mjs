import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DRONE_CATALOG } from '../src/data/droneCatalog.ts';
import { generatePlan, computeCoverage } from '../src/engines/planning/index.ts';
import { applyPlan } from '../src/services/missionPlanning.ts';
import { retainAvailableDrones, editPreparedMission } from '../src/services/missionResources.ts';
import { startMission, recalculateMission, triggerEmergencyLanding, advanceSimulation, restartOperation } from '../src/engines/operations/index.ts';
import { parseMission, serializeMission } from '../src/services/missionStorage.ts';
import { coveragePolygon, outsidePolygonOutline, pointInPolygon } from '../src/engines/geometry/index.ts';
const example = JSON.parse(readFileSync(new URL('../src/data/exampleMission.json', import.meta.url)));
function input(size = .006) {
  return { ...structuredClone(example), missionId: 'rectification', location: [0, 0], catalog: DRONE_CATALOG,
    scheduledAt: '2026-10-15T12:00:00Z', priorityZones: [],
    operationZone: { ...example.operationZone, geometry: { type: 'Polygon', coordinates: [[[0, 0], [size, 0], [size, size], [0, size], [0, 0]]] } },
    weather: { ...example.weather, status: 'available', source: 'test', rainDetected: false, dayNight: 'day' }, capabilityId: 'tp1-out-of-sight',
    constraints: { ...example.constraints, capabilityId: 'tp1-out-of-sight', maximumOverlapPercent: 100, minimumVerticalSeparationMeters: 10 },
    availableResources: { dronesByModel: Object.fromEntries(DRONE_CATALOG.map((model, i) => [model.id, i === 0 ? 2 : 0])) },
  };
}
function prepared() { const source = input(); return retainAvailableDrones(applyPlan(source, generatePlan(source))); }

test('surplus units survive recalculation, fleet/export and manual placement/engagement before launch', () => {
  const source = prepared(), before = structuredClone(source);
  assert.equal(source.drones.length, 2); assert.equal(source.drones.filter(d => d.status === 'reserve').length, 1);
  assert.equal(computeCoverage(source).usedDroneCount, 1);
  assert.deepEqual(parseMission(serializeMission(source)), source);
  const reserve = source.drones.find(d => d.status === 'reserve');
  const moved = editPreparedMission(source, { type: 'move_drone', droneId: reserve.id, dronePosition: [.003, .003] });
  assert.deepEqual(moved.mission.pilots.find(p => p.id === reserve.pilotId).pilotPosition, [.003, .003]);
  assert.equal(moved.mission.drones.find(d => d.id === reserve.id).status, 'reserve');
  const tuned = editPreparedMission(moved.mission, { type: 'set_altitude', droneId: reserve.id, altitudeMetersAgl: 40 });
  const deployed = editPreparedMission(tuned.mission, { type: 'set_availability', droneId: reserve.id, status: 'active' });
  assert.equal(deployed.mission.drones.find(d => d.id === reserve.id).status, 'ready');
  assert.equal(deployed.mission.drones.find(d => d.id === reserve.id).altitudeMetersAgl, 40);
  assert.equal(deployed.coverage.usedDroneCount, 2); assert.equal(deployed.conflicts.length, 0);
  assert.equal(startMission(deployed.mission).mission.drones.filter(d => d.status === 'active').length, 2);
  assert.deepEqual(source, before);
});

test('a reserve can also be placed and engaged after launching, without activating it automatically', () => {
  const source = startMission(prepared()).mission, reserve = source.drones.find(d => d.status === 'reserve');
  assert.equal(source.drones.filter(d => d.status === 'active').length, 1);
  const moved = recalculateMission(source, { type: 'move_drone', droneId: reserve.id, dronePosition: [.003, .003] });
  const deployed = recalculateMission(moved.mission, { type: 'set_availability', droneId: reserve.id, status: 'active' });
  assert.equal(deployed.conflicts.length, 0); assert.equal(deployed.coverage.usedDroneCount, 2);
});

test('emergency relaunch restores the original device after landing and round-trip, preserves reserves and unavailable units', () => {
  const source = startMission(prepared()).mission, before = structuredClone(source);
  const stopped = triggerEmergencyLanding(source).mission;
  assert.throws(() => restartOperation(stopped), /Attendez/);
  const landed = advanceSimulation(stopped, 1).mission;
  assert.equal(landed.drones[0].altitudeMetersAgl, 0);
  const restored = restartOperation(parseMission(serializeMission(landed))).mission;
  assert.equal(restored.status, 'active'); assert.deepEqual(restored.drones, before.drones);
  assert.equal(restored.emergencyRecovery, undefined); assert.deepEqual(source, before);
  const unavailable = recalculateMission(source, { type: 'set_availability', droneId: source.drones[0].id, status: 'unavailable' }).mission;
  assert.equal(restartOperation(advanceSimulation(triggerEmergencyLanding(unavailable).mission, 1).mission).mission.drones[0].status, 'unavailable');
});

test('large operations plan and import more than 32 drones; available counts can exceed 100', () => {
  const source = input(.1); source.availableResources.dronesByModel[DRONE_CATALOG[0].id] = 150;
  const plan = generatePlan(source);
  assert.ok(plan.drones.length > 32, `${plan.drones.length} drones`);
  assert.ok(computeCoverage(plan).totalCoveragePercent >= 95);
  assert.ok(!plan.warnings.some(w => w.includes('32')));
  const mission = applyPlan(source, plan);
  assert.deepEqual(parseMission(serializeMission(mission)), mission);
  mission.constraints.authorization = { reference: 'TEST', maximumDrones: 150, startAt: '2026-10-15T00:00:00Z', endAt: '2026-10-16T00:00:00Z' };
  assert.equal(parseMission(serializeMission(mission)).constraints.authorization.maximumDrones, 150);
});

test('dotted circle arcs contain only exterior segments, with exact boundary cuts and holes', () => {
  const operation = input().operationZone.geometry;
  operation.coordinates.push([[.002, .002], [.004, .002], [.004, .004], [.002, .004], [.002, .002]]);
  const outline = coveragePolygon({ center: [.003, .003], radiusMeters: 600, headingDegrees: 0, workingAngleDegrees: 360 });
  const paths = outsidePolygonOutline(outline, operation);
  assert.ok(paths.length > 0);
  for (const path of paths) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    assert.equal(pointInPolygon([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], operation), false);
  }
  const inner = coveragePolygon({ center: [.003, .003], radiusMeters: 40, headingDegrees: 0, workingAngleDegrees: 360 });
  assert.equal(outsidePolygonOutline(inner, operation).length, 1);
});
