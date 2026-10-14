import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { detectConflicts, recalculateMission, triggerEmergencyLanding, triggerReturnToHome, startMission, advanceSimulation, inspectMission, proposeLocalReorganization } from '../../src/engines/operations/index.ts';
import { DRONE_CATALOG } from '../../src/data/droneCatalog.ts';
const example = JSON.parse(readFileSync(new URL('../../src/data/exampleMission.json', import.meta.url), 'utf8'));
function mission() { const m = structuredClone(example); m.status = 'active'; m.drones.forEach(d => d.status = 'active'); return m; }

test('same altitude overlapping drones produce geometric vertical conflict; 10m separation does not', () => {
  const m = mission(); m.drones[1].altitudeMetersAgl = m.drones[0].altitudeMetersAgl;
  const conflict = detectConflicts(m).find(c => c.type === 'vertical_separation');
  assert.ok(conflict); assert.equal(conflict.altitudeDifferenceMeters, 0); assert.equal(conflict.droneIds.length, 2); assert.ok(conflict.approximatePosition);
  m.drones[1].altitudeMetersAgl += 10;
  assert.ok(!detectConflicts(m).some(c => c.type === 'vertical_separation'));
});
test('moving a drone updates center, preserves others, leaves pilot separate and does not mutate input', () => {
  const source = mission(), before = structuredClone(source);
  const result = recalculateMission(source, { type: 'move_drone', droneId: 'drone-1', dronePosition: [-1.679, 48.117] });
  assert.deepEqual(result.mission.drones[0].coverage.center, [-1.679, 48.117]);
  assert.deepEqual(result.mission.drones[1], source.drones[1]); assert.deepEqual(result.mission.pilots, source.pilots); assert.deepEqual(source, before);
});
test('pilot displacement changes reach conflicts without moving drones', () => {
  const source = mission();
  const result = recalculateMission(source, { type: 'move_pilot', pilotId: 'pilot-1', pilotPosition: [-1.8, 48.1] });
  assert.deepEqual(result.mission.drones, source.drones); assert.ok(result.conflicts.some(c => c.type === 'capability_limit'));
});
test('unavailability removes active coverage and optional repair moves at most one drone', () => {
  const source = mission(), before = inspectMission(source);
  const after = recalculateMission(source, { type: 'set_availability', droneId: 'drone-1', status: 'unavailable' });
  assert.equal(after.coverage.usedDroneCount, 1); assert.ok(after.coverage.totalCoveragePercent < before.coverage.totalCoveragePercent);
  const repaired = proposeLocalReorganization(after.mission);
  assert.ok(repaired.mission.drones.filter((d, i) => JSON.stringify(d) !== JSON.stringify(after.mission.drones[i])).length <= 1);
});
test('sector change reduces coverage and changes orientation, not positions', () => {
  const source = mission();
  const result = recalculateMission(source, { type: 'set_coverage', droneId: 'drone-1', headingDegrees: 180, workingAngleDegrees: 45 });
  assert.ok(result.coverage.totalCoveragePercent < inspectMission(source).coverage.totalCoveragePercent);
  assert.deepEqual(result.mission.drones[0].dronePosition, source.drones[0].dronePosition);
});
test('invalid geometry, altitude, cap and angle never yield NaN state', () => {
  for (const change of [{ type: 'set_altitude', droneId: 'drone-1', altitudeMetersAgl: Infinity },
    { type: 'set_altitude', droneId: 'drone-1', altitudeMetersAgl: 121 },
    { type: 'move_drone', droneId: 'drone-1', dronePosition: [NaN, 48] },
    { type: 'set_coverage', droneId: 'drone-1', headingDegrees: 360, workingAngleDegrees: 0 }]) assert.throws(() => recalculateMission(mission(), change));
});
test('emergency landing removes coverage immediately, descends in place, leaves unavailable drones untouched', () => {
  const source = mission(); source.drones[1].status = 'unavailable';
  const landing = triggerEmergencyLanding(source);
  assert.equal(landing.mission.status, 'emergency'); assert.equal(landing.mission.drones[0].status, 'emergency_landing'); assert.equal(landing.coverage.usedDroneCount, 0);
  const halfway = advanceSimulation(landing.mission, 0.5), end = advanceSimulation(landing.mission, 1);
  assert.equal(halfway.mission.drones[0].altitudeMetersAgl, source.drones[0].altitudeMetersAgl / 2);
  assert.deepEqual(end.mission.drones[0].dronePosition, source.drones[0].dronePosition);
  assert.equal(end.mission.drones[0].status, 'completed'); assert.equal(end.mission.status, 'emergency'); assert.equal(end.mission.drones[1].status, 'unavailable');
});
test('return interpolates toward each pilot then completes the mission; unavailable drone is exempt', () => {
  const source = mission(); source.drones[1].status = 'unavailable';
  const returning = triggerReturnToHome(source);
  assert.equal(returning.mission.status, 'returning'); assert.equal(returning.mission.drones[0].status, 'returning');
  const end = advanceSimulation(returning.mission, 1);
  assert.deepEqual(end.mission.drones[0].dronePosition, source.pilots[0].pilotPosition); assert.equal(end.mission.drones[0].altitudeMetersAgl, 0);
  assert.equal(end.mission.status, 'completed'); assert.equal(end.mission.drones[1].status, 'unavailable');
});
test('rain Mini and capacity violations are explicit, including launch refusal', () => {
  const source = mission(); source.weather = { ...source.weather, status: 'available', source: 'test', rainDetected: true };
  source.drones[0].modelId = 'dji-mini-5';
  assert.ok(detectConflicts(source).some(c => c.type === 'rain_incompatibility'));
  source.status = 'ready'; source.drones.forEach(d => d.status = 'ready'); assert.throws(() => startMission(source), /conflits/);
});
test('launch transitions ready drones and rejects repeated launch; completed mission cannot be edited', () => {
  const source = mission(); source.status = 'ready'; source.drones.forEach(d => d.status = 'ready');
  const result = startMission(source); assert.equal(result.mission.status, 'active');
  assert.throws(() => startMission(result.mission));
  const end = advanceSimulation(triggerReturnToHome(result.mission).mission, 1);
  assert.throws(() => recalculateMission(end.mission, { type: 'set_availability', droneId: 'drone-1', status: 'active' }));
});
test('typical recalculation remains below one second', () => {
  const source = mission(); const start = performance.now();
  const result = recalculateMission(source, { type: 'set_altitude', droneId: 'drone-1', altitudeMetersAgl: 40 });
  assert.ok(Number.isFinite(result.coverage.totalCoveragePercent)); assert.ok(performance.now() - start < 1000);
});

test('operations use embedded custom catalogue for capacities, resources and weather restrictions', () => {
  const source = mission(), custom = { ...DRONE_CATALOG[0], id: 'custom-model', name: 'Drone de test', nightCapable: true, incompatibleWithRain: false,
    capabilities: DRONE_CATALOG[0].capabilities.map(capability => ({ ...capability, maxAltitudeMetersAgl: { rural: 35, urban: 35 } })) };
  source.droneCatalog = [...DRONE_CATALOG, custom];
  source.drones[0].modelId = custom.id;
  source.availableResources.dronesByModel[custom.id] = 1;
  const edited = recalculateMission(source, { type: 'set_altitude', droneId: source.drones[0].id, altitudeMetersAgl: 30 });
  assert.equal(edited.mission.drones[0].altitudeMetersAgl, 30);
  assert.throws(() => recalculateMission(source, { type: 'set_altitude', droneId: source.drones[0].id, altitudeMetersAgl: 40 }), /35/);
  source.availableResources.dronesByModel[custom.id] = 0;
  assert.ok(detectConflicts(source).some(conflict => conflict.type === 'resource_shortage' && conflict.message.includes(custom.name)));
  source.weather.dayNight = 'night'; source.droneCatalog = [...DRONE_CATALOG, { ...custom, nightCapable: false }];
  assert.ok(detectConflicts(source).some(conflict => conflict.message.includes('mission de nuit') && conflict.droneIds.includes(source.drones[0].id)));
});

test('configured overlap limit produces an explicit launch conflict without modifying the mission', () => {
  const source = mission(), before = structuredClone(source);
  source.constraints.maximumOverlapPercent = 0;
  const conflicts = detectConflicts(source);
  assert.ok(conflicts.some(conflict => conflict.id === 'maximum-overlap' && conflict.message.includes('autorisés')));
  assert.deepEqual(source.drones, before.drones);
  source.status = 'ready'; source.drones.forEach(drone => { drone.status = 'ready'; });
  assert.throws(() => startMission(source), /conflits/);
});

test('optional authorization blocks launching outside its period or above its configured count', () => {
  const source = mission(), scheduled = Date.parse(source.scheduledAt);
  source.constraints.authorization = { reference: 'SIM-001', maximumDrones: 2,
    startAt: new Date(scheduled - 3600000).toISOString(), endAt: new Date(scheduled + 3600000).toISOString() };
  assert.ok(!detectConflicts(source).some(conflict => conflict.id.startsWith('authorization-')));
  source.constraints.authorization.maximumDrones = 1;
  assert.ok(detectConflicts(source).some(conflict => conflict.id === 'authorization-count'));
  source.status = 'ready'; source.drones.forEach(drone => { drone.status = 'ready'; });
  assert.throws(() => startMission(source), /conflits/);
  source.constraints.authorization.maximumDrones = 2;
  source.scheduledAt = new Date(scheduled + 7200000).toISOString();
  assert.ok(detectConflicts(source).some(conflict => conflict.id === 'authorization-window'));
  assert.throws(() => startMission(source), /conflits/);
});
