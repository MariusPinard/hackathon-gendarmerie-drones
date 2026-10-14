import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coverageMetrics, overlapPolygons, uncoveredDisplayPoints, pointInPolygon, pointInCoverage, unproject } from '../../src/engines/geometry/index.ts';
const origin = [1.87, 43.09];
const p = (x, y) => unproject([x, y], origin);
const operation = { type: 'Polygon', coordinates: [[p(-700,-700), p(700,-700), p(700,700), p(-700,700), p(-700,-700)]] };
const drone = (id, x, status = 'ready') => ({ id, status, coverage: { center: p(x,0), radiusMeters: 400, headingDegrees: 0, workingAngleDegrees: 360 } });

test('display dots are four times denser on an uncovered rectangle without changing metrics', () => {
  const before = coverageMetrics(operation, [], []);
  const points = uncoveredDisplayPoints(operation, []);
  assert.equal(points.length, before.uncoveredPoints.length * 4);
  assert.ok(points.every(point => pointInPolygon(point, operation)));
  assert.deepEqual(coverageMetrics(operation, [], []), before);
});

test('dense dots exclude covered cells and holes; reserves never hide uncovered ground', () => {
  const withHole = structuredClone(operation);
  withHole.coordinates.push([p(-50,-50), p(-50,50), p(50,50), p(50,-50), p(-50,-50)]);
  const active = drone('a', -250), reserve = drone('r', 250, 'reserve');
  const points = uncoveredDisplayPoints(withHole, [active, reserve]);
  assert.ok(points.length > 0);
  assert.ok(points.every(point => pointInPolygon(point, withHole) && !pointInCoverage(point, active.coverage)));
  assert.ok(points.some(point => pointInCoverage(point, reserve.coverage)));
});

test('yellow intersections contain only shared work areas inside the operation', () => {
  const a = drone('a', -250), b = drone('b', 250);
  const pieces = overlapPolygons(operation, [a, b]);
  assert.ok(pieces.length > 0);
  assert.ok(pieces.some(piece => pointInPolygon(origin, piece)));
  assert.ok(!pieces.some(piece => pointInPolygon(p(-400,0), piece)));
  assert.deepEqual(overlapPolygons(operation, [a, { ...b, status: 'reserve' }]), []);
  assert.deepEqual(overlapPolygons(operation, [drone('a', -500), drone('b', 500)]), []);
});

test('overlap clipping preserves holes, sectors and identical three-drone intersections', () => {
  const withHole = structuredClone(operation);
  withHole.coordinates.push([p(-50,-50), p(-50,50), p(50,50), p(50,-50), p(-50,-50)]);
  const a = drone('a', 0), b = drone('b', 0), c = drone('c', 0);
  const pieces = overlapPolygons(withHole, [a,b,c]);
  assert.equal(pieces.length, 3);
  assert.ok(pieces.every(piece => !pointInPolygon(origin, piece) && pointInPolygon(p(100,0), piece)));
  b.coverage.workingAngleDegrees = 90;
  const sectors = overlapPolygons(operation, [a,b]);
  assert.ok(sectors.some(piece => pointInPolygon(p(0,200), piece)));
  assert.ok(!sectors.some(piece => pointInPolygon(p(0,-200), piece)));
});
