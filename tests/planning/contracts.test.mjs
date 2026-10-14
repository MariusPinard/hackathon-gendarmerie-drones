import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DRONE_CATALOG, DRONE_CAPABILITIES } from '../../src/data/droneCatalog.ts';
import { estimateResources, generatePlan, computeCoverage } from '../../src/engines/planning/index.ts';
import { EngineNotImplementedError } from '../../src/engines/notImplemented.ts';

test('catalog exposes only the hackathon capabilities and Mini rain restriction', () => {
  assert.equal(DRONE_CATALOG.length, 3);
  assert.equal(DRONE_CAPABILITIES[0].rangeMeters, null);
  assert.deepEqual(DRONE_CAPABILITIES.map(c => c.rangeMeters), [null, 1000, 2000]);
  assert.deepEqual(DRONE_CAPABILITIES.map(c => c.maxAltitudeMetersAgl), [
    { rural: 120, urban: 120 }, { rural: 50, urban: 80 }, { rural: 120, urban: 120 },
  ]);
  assert.deepEqual(DRONE_CATALOG.filter(m => m.incompatibleWithRain).map(m => m.id), ['dji-mini-5']);
});

test('unimplemented planning cannot produce a misleading successful result', () => {
  for (const engine of [estimateResources, generatePlan, computeCoverage]) {
    assert.throws(() => engine({}), EngineNotImplementedError);
  }
});
