import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDrawnPolygon } from '../../src/engines/geometry/drawing.ts';

const points = [[1.44,43.60],[1.45,43.60],[1.45,43.61],[1.44,43.61]];
test('finish automatically closes last-to-first without mutating the source vertices', () => {
  const before = structuredClone(points);
  const polygon = closeDrawnPolygon(points);
  assert.deepEqual(polygon.coordinates[0], [...points, points[0]]);
  assert.deepEqual(points, before);
});
test('clicking the first point does not append a duplicate closing vertex', () => {
  const polygon = closeDrawnPolygon([...points, points[0]]);
  assert.equal(polygon.coordinates[0].length, 5);
  assert.deepEqual(polygon.coordinates[0][0], polygon.coordinates[0].at(-1));
});
test('invalid and crossed polygons cannot replace a saved operation zone', () => {
  assert.throws(() => closeDrawnPolygon(points.slice(0,2)), /trois/);
  assert.throws(() => closeDrawnPolygon([points[0],points[2],points[1],points[3]]), /croise/);
  assert.throws(() => closeDrawnPolygon([[0,0],[2,0],[2,2],[0,2]]), /grande/);
  assert.throws(() => closeDrawnPolygon([[NaN,43],[1,43],[1,44]]), /Coordonnées/);
});
