import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { DRONE_CATALOG } from '../../src/data/droneCatalog.ts';
import { generatePlan, estimateResources, computeCoverage, adjustPlanningCoverage } from '../../src/engines/planning/index.ts';
import { pointInCoverage, pointInPolygon, coveragesOverlap } from '../../src/engines/geometry/index.ts';

function input(width = .008, height = .006) {
  return { missionId: 'mixed-test', location: [0, 0], scheduledAt: '2026-10-15T12:00:00Z',
    operationZone: { type: 'Feature', properties: { kind: 'operation', id: 'op', name: 'Opération' }, geometry: {
      type: 'Polygon', coordinates: [[[0, 0], [width, 0], [width, height], [0, height], [0, 0]]],
    } }, priorityZones: [], weather: { status: 'available', location: [0, 0], dateTime: '2026-10-15T12:00:00Z', rainDetected: false, dayNight: 'day', source: 'test' },
    constraints: { environment: 'rural', minimumVerticalSeparationMeters: 30, maximumOverlapPercent: 20, defaultWorkingAngleDegrees: 360 },
    capabilityId: 'mixed', catalog: DRONE_CATALOG, availableResources: { dronesByModel: Object.fromEntries(DRONE_CATALOG.map(model => [model.id, 12])) } };
}

test('small operation needs one TP1, with radius adapted below its range and a clipped work area', () => {
  const source = input(), before = structuredClone(source), plan = generatePlan(source);
  assert.equal(plan.drones.length, 1);
  const drone = plan.drones[0];
  assert.equal(drone.capabilityId, 'tp1-out-of-sight');
  assert.ok(drone.coverage.radiusMeters > 0 && drone.coverage.radiusMeters <= 1000);
  assert.deepEqual(drone.coverage.clipPolygon, source.operationZone.geometry);
  assert.equal(pointInCoverage([-.001, .002], drone.coverage), false);
  assert.equal(computeCoverage(plan).totalCoveragePercent, 100);
  assert.deepEqual(source, before);
});

test('mixed profiles reduce drone count on an elongated operation and never waste TP2 below 1 km', () => {
  const source = input(.05, .01), mixed = generatePlan(source);
  const tp1 = generatePlan({ ...source, capabilityId: 'tp1-out-of-sight' });
  assert.ok(mixed.drones.length < tp1.drones.length);
  assert.ok(mixed.pilots.some(pilot => pilot.qualification === 'TP1'));
  assert.ok(mixed.pilots.some(pilot => pilot.qualification === 'TP2'));
  assert.ok(computeCoverage(mixed).totalCoveragePercent >= 98);
  for (const drone of mixed.drones) {
    const capability = DRONE_CATALOG.find(model => model.id === drone.modelId).capabilities.find(capability => capability.id === drone.capabilityId);
    assert.ok(drone.coverage.radiusMeters <= capability.rangeMeters);
    if (capability.pilotQualification === 'TP2') assert.ok(drone.coverage.radiusMeters > 1000);
    assert.ok(drone.altitudeMetersAgl <= capability.maxAltitudeMetersAgl.rural);
  }
  for (const a of mixed.drones) for (const b of mixed.drones) if (a.id !== b.id && coveragesOverlap(a.coverage, b.coverage))
    assert.ok(Math.abs(a.altitudeMetersAgl - b.altitudeMetersAgl) >= 30 || mixed.warnings.some(warning => warning.includes('altitude')));
});

test('noncircular operation with a hole is fully respected by coverage predicates', () => {
  const source = input(.02, .02);
  source.operationZone.geometry.coordinates = [[[0, 0], [.02, 0], [.02, .008], [.008, .008], [.008, .02], [0, .02], [0, 0]],
    [[.002, .002], [.006, .002], [.006, .006], [.002, .006], [.002, .002]]];
  const plan = generatePlan(source), metrics = computeCoverage(plan);
  assert.ok(metrics.totalCoveragePercent >= 98);
  assert.ok(plan.drones.every(drone => pointInPolygon(drone.dronePosition, source.operationZone.geometry)));
  assert.ok(plan.drones.every(drone => !pointInCoverage([.004, .004], drone.coverage) && !pointInCoverage([.016, .016], drone.coverage)));
});

test('configured working angle and overlap ceiling are enforced with clear partial coverage when needed', () => {
  const source = input(.045, .035);
  source.constraints.maximumOverlapPercent = 0;
  source.constraints.defaultWorkingAngleDegrees = 90;
  source.availableResources.dronesByModel = Object.fromEntries(DRONE_CATALOG.map(model => [model.id, 1]));
  const plan = generatePlan(source), metrics = computeCoverage(plan);
  assert.ok(plan.drones.every(drone => drone.coverage.workingAngleDegrees <= 90));
  assert.equal(metrics.overlapPercent, 0);
  assert.ok(plan.drones.length <= 3);
  assert.ok(metrics.totalCoveragePercent < 98);
  assert.ok(plan.warnings.some(warning => warning.includes('partielle')));
  assert.throws(() => generatePlan({ ...source, constraints: { ...source.constraints, maximumOverlapPercent: 101 } }), /Chevauchement/);
});

test('rain or night excludes Mavic and Mini independently; custom models participate with explicit abilities', () => {
  for (const weather of [{ dayNight: 'night', rainDetected: false }, { dayNight: 'day', rainDetected: true }]) {
    const source = input(); source.weather = { ...source.weather, ...weather };
    assert.ok(generatePlan(source).drones.every(drone => drone.modelId === 'dji-matrice-4t'));
  }
  const source = input(), custom = { ...DRONE_CATALOG[0], id: 'custom-field', name: 'Drone personnalisé', nightCapable: true, incompatibleWithRain: false };
  source.catalog = [custom]; source.availableResources.dronesByModel = { 'custom-field': 2 };
  source.weather = { ...source.weather, dayNight: 'night', rainDetected: true };
  const plan = generatePlan(source);
  assert.deepEqual(Object.keys(plan.estimate.dronesByModel), ['custom-field']);
  assert.equal(plan.drones[0].modelId, 'custom-field');
  assert.equal(estimateResources(source).pilotCount, 1);
  source.catalog = [{ ...custom, nightCapable: false }];
  assert.throws(() => generatePlan(source), /compatible/);
});

test('typical mixed estimation is bounded and resource shortage preserves the source', () => {
  const source = input(.05, .01); source.availableResources.dronesByModel = Object.fromEntries(DRONE_CATALOG.map(model => [model.id, 0]));
  const before = structuredClone(source), start = performance.now(), plan = generatePlan(source);
  assert.equal(plan.drones.length, 0);
  assert.equal(computeCoverage(plan).totalCoveragePercent, 0);
  assert.deepEqual(source, before);
  assert.ok(performance.now() - start < 1500);
});

test('proposal edits preview sectors immutably and downgrade TP2 to TP1 for a shorter radius', () => {
  const source = input(.05, .01), plan = generatePlan(source), before = structuredClone(plan);
  const drone = plan.drones.find(item => item.capabilityId === 'tp2-out-of-sight');
  const edited = adjustPlanningCoverage(source, plan, drone.id, { headingDegrees: 90, workingAngleDegrees: 45, radiusMeters: 800 });
  const updated = edited.drones.find(item => item.id === drone.id);
  assert.equal(updated.capabilityId, 'tp1-out-of-sight');
  assert.equal(edited.pilots.find(pilot => pilot.id === drone.pilotId).qualification, 'TP1');
  assert.deepEqual(updated.dronePosition, drone.dronePosition);
  assert.equal(updated.coverage.radiusMeters, 800);
  assert.equal(updated.coverage.workingAngleDegrees, 45);
  assert.equal(updated.coverage.headingDegrees, 90);
  assert.deepEqual(updated.coverage.clipPolygon, source.operationZone.geometry);
  assert.ok(updated.altitudeMetersAgl <= 50);
  assert.deepEqual(plan, before);
  assert.ok(computeCoverage(edited).totalCoveragePercent < computeCoverage(plan).totalCoveragePercent);
  for (const change of [{ headingDegrees: NaN, workingAngleDegrees: 45, radiusMeters: 800 },
    { headingDegrees: 90, workingAngleDegrees: 361, radiusMeters: 800 }, { headingDegrees: 90, workingAngleDegrees: 45, radiusMeters: 2001 }])
    assert.throws(() => adjustPlanningCoverage(source, plan, drone.id, change));
});

test('proposal edits upgrade TP1 only in mixed mode, within TP2 range', () => {
  const source = input(), plan = generatePlan(source), drone = plan.drones[0], before = structuredClone(plan);
  const updated = adjustPlanningCoverage(source, plan, drone.id, { headingDegrees: 0, workingAngleDegrees: 180, radiusMeters: 1500 });
  assert.equal(updated.drones[0].capabilityId, 'tp2-out-of-sight');
  assert.equal(updated.pilots[0].qualification, 'TP2');
  assert.equal(updated.drones[0].coverage.radiusMeters, 1500);
  assert.deepEqual(plan, before);
  assert.throws(() => adjustPlanningCoverage({ ...source, capabilityId: 'tp1-out-of-sight' }, plan, drone.id,
    { headingDegrees: 0, workingAngleDegrees: 180, radiusMeters: 1500 }), /1000/);
});

test('thin operations with a valid metric grid use a bounded fallback candidate grid', () => {
  const source = input(.05, .002), plan = generatePlan(source);
  assert.ok(plan.drones.length > 0);
  assert.ok(computeCoverage(plan).totalCoveragePercent >= 98);
  assert.ok(plan.drones.every(drone => pointInPolygon(drone.dronePosition, source.operationZone.geometry)));
});

const authorization = maximumDrones => ({ reference: 'SIM-2026-001', maximumDrones, startAt: '2026-10-15T11:00:00Z', endAt: '2026-10-15T13:00:00Z' });
test('optional authorization limits planning to zero or two drones without inventing available resources', () => {
  const source = input(.05, .035);
  source.constraints.authorization = authorization(0);
  const empty = generatePlan(source);
  assert.equal(empty.drones.length, 0);
  assert.equal(empty.estimate.pilotCount, 0);
  assert.ok(empty.warnings.some(warning => warning.includes('aucun drone autorisé')));
  source.constraints.authorization = authorization(2);
  const before = structuredClone(source), limited = generatePlan(source);
  assert.equal(limited.drones.length, 2);
  assert.ok(computeCoverage(limited).totalCoveragePercent < 98);
  assert.ok(limited.warnings.some(warning => warning.includes('plafond de 2')));
  assert.deepEqual(source, before);
});

test('authorization dates and counts are validated, with explicit out-of-window planning warning', () => {
  const source = input(); source.constraints.authorization = authorization(2);
  assert.ok(!generatePlan(source).warnings.some(warning => warning.includes('Hors période')));
  source.scheduledAt = '2026-10-15T13:00:01Z';
  assert.ok(generatePlan(source).warnings.some(warning => warning.includes('Hors période autorisée')));
  source.constraints.authorization.maximumDrones = NaN;
  assert.throws(() => generatePlan(source), /Autorisation/);
  source.constraints.authorization = { ...authorization(2), endAt: '2026-10-15T10:00:00Z' };
  assert.throws(() => generatePlan(source), /période/);
});
