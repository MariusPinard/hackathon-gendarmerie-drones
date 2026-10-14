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

test('world zoom enumerates a bounded central tile set and malformed bounds are ignored', () => {
  const started = performance.now(), tiles = tilesFor(-180, -85, 180, 85);
  assert.ok(tiles.length > 24 && tiles.length <= 2048);
  assert.ok(performance.now() - started < 1000);
  assert.ok(tiles.every(tile => Math.abs(tile.bbox[0]) < 1 && Math.abs(tile.bbox[1]) < 1));
  assert.deepEqual(tilesFor(NaN, 0, 1, 1), []);
  assert.deepEqual(tilesFor(1, 1, 0, 0), []);
});

test('precomputed coverage does not hide a hole or a concave bite from live assessment', () => {
  const shape = coordinates => ({ ...commune, commune: { ...commune.commune, geometry: { type: 'Polygon', coordinates } } });
  const box = [0, 0, 1, 1];
  const outer = [[-1,-1],[2,-1],[2,2],[-1,2],[-1,-1]];
  assert.equal(tileCoveredBy(shape([outer]), box), true);
  const hole = [[.3,.3],[.7,.3],[.7,.7],[.3,.7],[.3,.3]];
  assert.equal(tileCoveredBy(shape([outer, hole]), box), false);
  const concave = [[-1,-1],[2,-1],[2,2],[.6,2],[.6,.5],[.4,.5],[.4,2],[-1,2],[-1,-1]];
  assert.equal(tileCoveredBy(shape([concave]), box), false);
});

import { validateOccupancyMap, fetchOccupancyTile, loadCommuneOccupancy } from '../src/services/occupancy.ts';

test('shipped occupancy validates; malformed status, verdict or geometry cannot reach the renderer', () => {
  validateOccupancyMap(commune.occupancy);
  for (const change of [map => { map.zones[0].status = 'constructor'; }, map => { map.zones[0].takeoff = 'unknown'; },
    map => { map.zones[0].geometry.coordinates = [[[[0,0],[1,0],[1,1],[NaN,0]]]]; }]) {
    const copy = structuredClone(commune.occupancy); change(copy);
    assert.throws(() => validateOccupancyMap(copy), /incompatible/);
  }
});

test('live occupancy posts only the requested bounds, honors cancellation and reports service failures', async () => {
  const tile = tilesFor(1.8745,43.0876,1.8746,43.0877)[0];
  const data = { ...commune.occupancy, zones: [] }, original = globalThis.fetch;
  try {
    const controller = new AbortController();
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:8000/api/v1/occupancy/tile');
      assert.equal(options.method, 'POST'); assert.deepEqual(JSON.parse(options.body), { bbox: tile.bbox });
      assert.equal(options.signal.aborted, false);
      return { ok: true, json: async () => data };
    };
    assert.deepEqual(await fetchOccupancyTile('http://127.0.0.1:8000', tile, controller.signal), data);
    globalThis.fetch = async (_url, options) => { assert.equal(options.signal.aborted, true); throw new Error('aborted'); };
    controller.abort(); await assert.rejects(fetchOccupancyTile('http://127.0.0.1:8000', tile, controller.signal), /aborted/);
    globalThis.fetch = async () => { throw new Error('network'); };
    await assert.rejects(fetchOccupancyTile('http://127.0.0.1:8000', tile), /injoignable/);
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'Calcul indisponible' } }) });
    await assert.rejects(fetchOccupancyTile('http://127.0.0.1:8000', tile), /Calcul indisponible/);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ kind: 'takeoff_occupancy', zones: [] }) });
    await assert.rejects(fetchOccupancyTile('http://127.0.0.1:8000', tile), /incompatible/);
  } finally { globalThis.fetch = original; }
});

test('precomputed commune loading uses the bundled file and validates its payload', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async url => { assert.equal(url, '/occupancy/commune-09194.json'); return { ok: true, json: async () => commune }; };
    assert.deepEqual(await loadCommuneOccupancy('09194'), commune);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ...commune, commune: { ...commune.commune, geometry: {} } }) });
    await assert.rejects(loadCommuneOccupancy('09194'), /incompatible/);
  } finally { globalThis.fetch = original; }
});
