import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coveragePolygons, intersectPolygons, pointInCoverage, pointInPolygon, coveragesOverlap, samplePolygon } from '../../src/engines/geometry/index.ts';

const polygon = coordinates => ({ type: 'Polygon', coordinates });
const rectangle = (west, south, east, north) => polygon([[[west, south], [east, south], [east, north], [west, north], [west, south]]]);
const operation = polygon([[[0, 0], [.02, 0], [.02, .008], [.008, .008], [.008, .02], [0, .02], [0, 0]],
  [[.002, .002], [.006, .002], [.006, .006], [.002, .006], [.002, .002]]]);
const work = { center: [.008, .008], radiusMeters: 3000, headingDegrees: 0, workingAngleDegrees: 360, clipPolygon: operation };

test('work areas are clipped to a concave operation and exclude its holes', () => {
  const before = structuredClone(work), pieces = coveragePolygons(work);
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].coordinates.length, 2);
  assert.equal(pointInCoverage([.004, .004], work), false);
  assert.equal(pointInCoverage([.016, .016], work), false);
  assert.equal(pointInCoverage([.004, .014], work), true);
  for (const piece of pieces) assert.ok(samplePolygon(piece, 25).points.every(point => pointInPolygon(point, operation)));
  assert.deepEqual(work, before);
  const identical = intersectPolygons(pieces[0], pieces[0]);
  assert.equal(identical[0].coordinates.length, 2);
  assert.equal(pointInPolygon([.004, .004], identical[0]), false);
});

test('intersection can produce disconnected pieces, with either source winding', () => {
  const u = polygon([[[0, 0], [.006, 0], [.006, .014], [.014, .014], [.014, 0], [.02, 0], [.02, .02], [0, .02], [0, 0]]]);
  const horizontal = rectangle(-.005, .004, .025, .01);
  const pieces = intersectPolygons(u, horizontal);
  assert.equal(pieces.length, 2);
  assert.ok(pieces.every(piece => samplePolygon(piece).points.every(point => pointInPolygon(point, u) && pointInPolygon(point, horizontal))));
  assert.equal(intersectPolygons({ ...u, coordinates: [u.coordinates[0].toReversed()] }, horizontal).length, 2);
});

test('sector clipping preserves the bearing and overlap ignores everything outside operation', () => {
  const sector = { ...work, headingDegrees: 90, workingAngleDegrees: 60 };
  assert.ok(coveragePolygons(sector).length > 0);
  assert.equal(pointInCoverage([.016, .006], sector), true);
  assert.equal(pointInCoverage([.004, .014], sector), false);
  const a = { ...work, clipPolygon: rectangle(0, 0, .006, .006) };
  const b = { ...work, clipPolygon: rectangle(.012, .012, .018, .018) };
  assert.equal(coveragesOverlap(a, b), false);
  assert.equal(coveragesOverlap(a, a), true);
  assert.equal(coveragePolygons({ ...a, center: [1, 1], radiusMeters: 100 }).length, 0);
});

test('touching boundaries do not create a false area overlap', () => {
  const a = rectangle(0, 0, .01, .01), b = rectangle(.01, 0, .02, .01);
  assert.deepEqual(intersectPolygons(a, b), []);
});
