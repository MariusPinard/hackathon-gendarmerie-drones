import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TILE_LAT, TILE_LON, tileCoveredBy, tilesFor } from '../src/services/occupancy.ts';

const commune = JSON.parse(readFileSync(new URL('../public/occupancy/commune-09194.json', import.meta.url), 'utf-8'));

test('the tile grid is fixed, gapless and stable when the view moves', () => {
  const tiles = tilesFor(1.861, 43.081, 1.889, 43.094);
  assert.ok(tiles.length >= 6 && tiles.length <= 15);
  for (const { bbox: [w, s, e, n] } of tiles) {
    assert.ok(Math.abs(e - w - TILE_LON) < 1e-9 && Math.abs(n - s - TILE_LAT) < 1e-9);
  }
  const shifted = tilesFor(1.862, 43.082, 1.888, 43.093).map(t => t.key);
  assert.ok(shifted.every(key => tiles.some(t => t.key === key)));
});

test('tiles inside the precomputed commune need no live request', () => {
  assert.equal(commune.commune.insee, '09194');
  const [centre] = tilesFor(1.8745, 43.0876, 1.8746, 43.0877);
  assert.equal(tileCoveredBy(commune, centre.bbox), true);
  const [toulouse] = tilesFor(1.444, 43.6045, 1.445, 43.605);
  assert.equal(tileCoveredBy(commune, toulouse.bbox), false);
  assert.equal(tileCoveredBy(null, centre.bbox), false);
  for (const zone of commune.occupancy.zones) assert.ok(['possible', 'conditional', 'impossible'].includes(zone.takeoff));
});
