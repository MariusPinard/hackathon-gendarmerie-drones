import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { DRONE_CATALOG } from '../../src/data/droneCatalog.ts';
import { generatePlan, computeCoverage, MIN_GAIN_PER_DRONE } from '../../src/engines/planning/index.ts';
import { pointInPolygon, distanceMeters } from '../../src/engines/geometry/index.ts';

const LAT = 43.09, LON = 1.87;
const m = (dx, dy) => [LON + dx / (111320 * Math.cos(LAT * Math.PI / 180)), LAT + dy / 111320];
const rect = (w, h) => [[m(0, 0), m(w, 0), m(w, h), m(0, h), m(0, 0)]];
function input(coordinates, extra = {}) {
  return { missionId: 'optimizer', location: m(0, 0), scheduledAt: '2026-10-15T12:00:00Z',
    operationZone: { type: 'Feature', properties: { kind: 'operation', id: 'op', name: 'Op' }, geometry: { type: 'Polygon', coordinates } },
    priorityZones: [], weather: { status: 'available', location: m(0, 0), dateTime: '2026-10-15T12:00:00Z', rainDetected: false, dayNight: 'day', source: 'test' },
    constraints: { environment: 'rural', minimumVerticalSeparationMeters: 30, maximumOverlapPercent: 20, defaultWorkingAngleDegrees: 360 },
    capabilityId: 'mixed', catalog: DRONE_CATALOG, availableResources: { dronesByModel: Object.fromEntries(DRONE_CATALOG.map(model => [model.id, 40])) }, ...extra };
}

function assertValid(source, plan) {
  const metrics = computeCoverage(plan);
  assert.ok(metrics.overlapPercent <= source.constraints.maximumOverlapPercent + 1, `overlap ${metrics.overlapPercent}`);
  for (const drone of plan.drones) {
    const capability = DRONE_CATALOG.find(model => model.id === drone.modelId).capabilities.find(item => item.id === drone.capabilityId);
    assert.ok(drone.coverage.radiusMeters <= capability.rangeMeters, 'radius within range');
    if (capability.pilotQualification === 'TP2') assert.ok(drone.coverage.radiusMeters > 1000, 'no TP2 at 1 km or less');
    assert.ok(pointInPolygon(drone.dronePosition, source.operationZone.geometry), 'drone starts inside the operation area');
    assert.ok(distanceMeters(plan.pilots.find(p => p.id === drone.pilotId).pilotPosition, drone.dronePosition) <= capability.rangeMeters);
  }
  return metrics;
}

/** The retained point is the trade-off: the next drones on the curve bring less than the minimum gain each. */
function assertTradeoff(plan) {
  const curve = plan.tradeoff, index = curve.findIndex(point => point.chosen);
  assert.ok(index >= 0, 'chosen point marked');
  assert.ok(plan.drones.length <= curve[index].drones, 'redundant drones may only be removed');
  for (let j = index + 1; j < curve.length; j++) {
    const perDrone = (curve[j].coveragePercent - curve[index].coveragePercent) / (curve[j].drones - curve[index].drones);
    assert.ok(perDrone < MIN_GAIN_PER_DRONE + 0.5, `${curve[j].drones} drones would bring ${perDrone.toFixed(1)} pts/drone`);
  }
  for (let j = 1; j < curve.length; j++) assert.ok(curve[j].drones > curve[j - 1].drones && curve[j].coveragePercent >= curve[j - 1].coveragePercent - 0.5, 'non-dominated curve');
}

test('5 × 5 km square: four TP2 in quadrants cover ≥ 98 % (the greedy alone needed five)', () => {
  const source = input(rect(5000, 5000)), plan = generatePlan(source);
  assert.ok(plan.drones.length <= 4, `${plan.drones.length} drones`);
  assert.ok(assertValid(source, plan).totalCoveragePercent >= 98);
  assertTradeoff(plan);
});

test('TP1 only, 4 × 3 km: best coverage/drone trade-off (the greedy used 8 drones)', () => {
  const source = input(rect(4000, 3000), { capabilityId: 'tp1-out-of-sight' }), plan = generatePlan(source);
  assert.ok(plan.drones.length <= 6, `${plan.drones.length} drones`);
  assert.ok(plan.drones.every(drone => drone.capabilityId === 'tp1-out-of-sight'));
  assert.ok(assertValid(source, plan).totalCoveragePercent >= 94);
  assertTradeoff(plan);
});

test('priority areas weigh four times: full priority coverage with fewer drones', () => {
  const source = input(rect(4000, 4000));
  source.priorityZones = [{ type: 'Feature', properties: { kind: 'priority', id: 'p', name: 'P' }, geometry: { type: 'Polygon', coordinates: [[m(2500, 2500), m(3800, 2500), m(3800, 3800), m(2500, 3800), m(2500, 2500)]] } }];
  const plan = generatePlan(source);
  assert.ok(plan.drones.length <= 3, `${plan.drones.length} drones`);
  assert.equal(assertValid(source, plan).priorityCoveragePercent, 100);
});

test('a lower minimum gain buys more coverage with more drones (operator setting)', () => {
  const source = input(rect(4000, 3000), { capabilityId: 'tp1-out-of-sight' });
  const strict = generatePlan(source), generous = generatePlan({ ...source, minimumGainPerDronePercent: 0.5 });
  assert.ok(generous.drones.length >= strict.drones.length);
  assert.ok(computeCoverage(generous).totalCoveragePercent >= computeCoverage(strict).totalCoveragePercent);
});

test('optimisation is deterministic and fast enough for the planning button', () => {
  const source = input([[m(0, 0), m(5000, 0), m(5000, 1800), m(1800, 1800), m(1800, 5000), m(0, 5000), m(0, 0)]]);
  const started = performance.now();
  const first = generatePlan(source);
  const elapsed = performance.now() - started;
  assert.deepEqual(generatePlan(source), first);
  assert.ok(elapsed < 5000, `${Math.round(elapsed)} ms`);
  assertValid(source, first);
  assert.ok(first.estimate.assumptions[0].includes('Compromis'));
});

test('working angles above 330° become a full 360° circle (planning, manual edit, operations)', async () => {
  const { adjustPlanningCoverage } = await import('../../src/engines/planning/index.ts');
  const { snapWorkingAngle } = await import('../../src/engines/geometry/index.ts');
  assert.equal(snapWorkingAngle(331), 360);
  assert.equal(snapWorkingAngle(330), 330);
  assert.equal(snapWorkingAngle(90), 90);
  const source = input(rect(4000, 3000)), plan = generatePlan(source);
  assert.ok(plan.drones.every(drone => drone.coverage.workingAngleDegrees <= 330 || drone.coverage.workingAngleDegrees === 360));
  const drone = plan.drones[0];
  const edited = adjustPlanningCoverage(source, plan, drone.id, { headingDegrees: 10, workingAngleDegrees: 345, radiusMeters: drone.coverage.radiusMeters });
  assert.equal(edited.drones[0].coverage.workingAngleDegrees, 360);
  const kept = adjustPlanningCoverage(source, plan, drone.id, { headingDegrees: 10, workingAngleDegrees: 300, radiusMeters: drone.coverage.radiusMeters });
  assert.equal(kept.drones[0].coverage.workingAngleDegrees, 300);
});
