import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DRONE_CATALOG, DRONE_CAPABILITIES } from '../../src/data/droneCatalog.ts';
import { estimateResources, generatePlan, computeCoverage } from '../../src/engines/planning/index.ts';
import { readFileSync } from 'node:fs';
import { coveragesOverlap } from '../../src/engines/geometry/index.ts';

test('catalog exposes only the hackathon capabilities and Mini rain restriction', () => {
  assert.equal(DRONE_CATALOG.length, 3);
  assert.equal(DRONE_CAPABILITIES[0].rangeMeters, null);
  assert.deepEqual(DRONE_CAPABILITIES.map(c => c.rangeMeters), [null, 1000, 2000]);
  assert.deepEqual(DRONE_CAPABILITIES.map(c => c.maxAltitudeMetersAgl), [
    { rural: 120, urban: 120 }, { rural: 50, urban: 80 }, { rural: 120, urban: 120 },
  ]);
  assert.deepEqual(DRONE_CATALOG.filter(m => m.incompatibleWithRain).map(m => m.id), ['dji-mini-5']);
});

const mission = JSON.parse(readFileSync(new URL('../../src/data/exampleMission.json', import.meta.url)));
function input() {
  return { ...structuredClone(mission), missionId: mission.metadata.id, catalog: DRONE_CATALOG,
    capabilityId: 'tp1-out-of-sight', operationZone: { ...mission.operationZone, geometry: {
      type: 'Polygon', coordinates: [[[-1.7, 48.10], [-1.64, 48.10], [-1.64, 48.14], [-1.7, 48.14], [-1.7, 48.10]]],
    } }, availableResources: { dronesByModel: { 'dji-matrice-4t': 8, 'dji-mavic-3-enterprise': 8, 'dji-mini-5': 8 } } };
}
test('rectangle: deterministic plan, finite metrics, no mutation and altitude limits', () => {
  const source = input(), before = structuredClone(source), result = generatePlan(source);
  assert.deepEqual(generatePlan(source), result);
  assert.deepEqual(source, before);
  assert.ok(computeCoverage(result).totalCoveragePercent > 90);
  assert.ok(result.drones.length > 1);
  for (const d of result.drones) assert.ok(d.altitudeMetersAgl <= 80 && d.coverage.radiusMeters === 1000);
  for (const a of result.drones) for (const b of result.drones) if (a.id !== b.id && coveragesOverlap(a.coverage, b.coverage))
    assert.ok(Math.abs(a.altitudeMetersAgl - b.altitudeMetersAgl) >= 10 || result.warnings.some(w => w.includes('altitude')));
});
test('central priority is covered first with scarce resources', () => {
  const source = input();
  source.availableResources.dronesByModel = { 'dji-matrice-4t': 1, 'dji-mavic-3-enterprise': 0, 'dji-mini-5': 0 };
  const result = generatePlan(source), metric = computeCoverage(result);
  assert.equal(result.drones.length, 1);
  assert.ok(metric.priorityCoveragePercent > 90);
  assert.ok(metric.totalCoveragePercent < 50);
  assert.ok(result.warnings.some(w => w.includes('partielle')));
});
test('estimation is reusable and independent of current availability', () => {
  const source = input(), estimate = estimateResources(source);
  source.availableResources.dronesByModel = estimate.dronesByModel;
  assert.equal(generatePlan(source).drones.length, estimate.pilotCount);
  assert.ok(estimate.assumptions.length > 0);
});
test('zero resources produces an explicit empty partial plan', () => {
  const source = input();
  source.availableResources.dronesByModel = { 'dji-matrice-4t': 0, 'dji-mavic-3-enterprise': 0, 'dji-mini-5': 0 };
  const result = generatePlan(source);
  assert.equal(result.drones.length, 0);
  assert.equal(computeCoverage(result).totalCoveragePercent, 0);
});
test('rain excludes Mini; in-sight refuses an invented radius; TP2 uses 2km', () => {
  const source = input();
  source.weather.rainDetected = true;
  assert.ok(generatePlan(source).drones.every(d => d.modelId !== 'dji-mini-5'));
  source.capabilityId = 'tp1-in-sight';
  assert.throws(() => generatePlan(source), /portée/);
  source.capabilityId = 'tp2-out-of-sight';
  assert.ok(generatePlan(source).drones.every(d => d.coverage.radiusMeters === 2000 && d.altitudeMetersAgl <= 120));
});
test('invalid resource quantities are rejected', () => {
  const source = input();
  source.availableResources.dronesByModel['dji-matrice-4t'] = NaN;
  assert.throws(() => generatePlan(source), /Quantité/);
});
