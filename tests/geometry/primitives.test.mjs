import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pointInPolygon, validatePolygon, distanceMeters, project, unproject, samplePolygon, pointInCoverage, coveragesOverlap, coverageMetrics } from '../../src/engines/geometry/index.ts';

const square = { type: 'Polygon', coordinates: [[[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02], [0, 0]]] };
const coverage = { center: [0.01, 0.01], radiusMeters: 2000, headingDegrees: 0, workingAngleDegrees: 360 };

test('point-in-polygon includes outer boundary, excludes holes and exterior', () => {
  assert.equal(pointInPolygon([0.01, 0.01], square), true);
  assert.equal(pointInPolygon([0, 0.01], square), true);
  assert.equal(pointInPolygon([0.03, 0.01], square), false);
  const hole = [[0.005, 0.005], [0.015, 0.005], [0.015, 0.015], [0.005, 0.015], [0.005, 0.005]];
  const holed = { ...square, coordinates: [...square.coordinates, hole] };
  validatePolygon(holed);
  assert.equal(pointInPolygon([0.01, 0.01], holed), false);
});
test('projection round-trip and distance are stable in meter units', () => {
  const p = [-1.67, 48.12], origin = [-1.68, 48.11];
  assert.deepEqual(unproject(project(p, origin), origin), p);
  assert.ok(Math.abs(distanceMeters([0, 0], [0, 0.01]) - 1111.95) < 0.1);
});
test('sampling is bounded, deterministic and confined to the polygon', () => {
  const grid = samplePolygon(square);
  assert.deepEqual(grid, samplePolygon(square));
  assert.ok(grid.points.length > 100 && grid.points.length <= 2500);
  assert.ok(grid.points.every(p => pointInPolygon(p, square)));
});
test('disk and oriented sector use north-clockwise bearings', () => {
  assert.equal(pointInCoverage([0.01, 0.02], coverage), true);
  const sector = { ...coverage, workingAngleDegrees: 90 };
  assert.equal(pointInCoverage([0.01, 0.02], sector), true);
  assert.equal(pointInCoverage([0.01, 0], sector), false);
  assert.equal(pointInCoverage([0.02, 0.01], sector), false);
  assert.equal(pointInCoverage([0.02, 0.01], { ...sector, headingDegrees: 90 }), true);
});
test('overlap supports disks and separated sectors', () => {
  assert.equal(coveragesOverlap(coverage, coverage), true);
  assert.equal(coveragesOverlap(coverage, { ...coverage, center: [1, 1] }), false);
  assert.equal(coveragesOverlap({ ...coverage, center: [0.01, 0.02], workingAngleDegrees: 30 },
    { ...coverage, center: [0.01, 0], headingDegrees: 180, workingAngleDegrees: 30 }), false);
});
test('coverage metrics omit unavailable drones and report priorities/overlap', () => {
  const drone = { coverage, status: 'active' };
  const priorities = [{ geometry: square }];
  const metric = coverageMetrics(square, priorities, [drone, drone]);
  assert.equal(metric.totalCoveragePercent, 100);
  assert.equal(metric.priorityCoveragePercent, 100);
  assert.equal(metric.overlapPercent, 100);
  assert.equal(metric.overlapOutsidePrioritySquareMeters, 0);
  assert.equal(coverageMetrics(square, [], [{ ...drone, status: 'unavailable' }]).totalCoveragePercent, 0);
});
test('rejects self-intersection, degenerate and excessive domains', () => {
  assert.throws(() => validatePolygon({ type: 'Polygon', coordinates: [[[0, 0], [0.02, 0.02], [0, 0.02], [0.02, 0], [0, 0]]] }));
  assert.throws(() => samplePolygon({ type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }), /trop grande/);
});
