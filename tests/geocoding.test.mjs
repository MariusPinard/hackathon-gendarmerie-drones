import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchAddresses } from '../src/services/geocoding.ts';

test('address search uses the public provider and returns validated WGS84 suggestions', async () => {
  const results = await searchAddresses('  Place du Capitole Toulouse  ', { fetcher: async url => {
    assert.equal(url.hostname, 'data.geopf.fr');
    assert.equal(url.searchParams.get('q'), 'Place du Capitole Toulouse');
    assert.equal(url.searchParams.get('limit'), '5');
    return { ok: true, json: async () => ({ features: [{ geometry: { type: 'Point', coordinates: [1.443054, 43.604354] }, properties: { label: 'Place du Capitole 31000 Toulouse' } }] }) };
  } });
  assert.equal(results[0].label, 'Place du Capitole 31000 Toulouse');
  assert.deepEqual(results[0].coordinates, [1.443054, 43.604354]);
});

test('short queries do not call the provider and oversized input is rejected', async () => {
  let called = false;
  const fetcher = async () => { called = true; throw new Error(); };
  assert.deepEqual(await searchAddresses('Tou', { fetcher }), []);
  assert.equal(called, false);
  await assert.rejects(() => searchAddresses('a'.repeat(201), { fetcher }), /longue/);
});

test('malformed candidates, invalid coordinates and missing labels are discarded', async () => {
  const features = [null, { geometry: { type: 'Point', coordinates: [1, Infinity] }, properties: { label: 'invalid' } },
    { geometry: { type: 'Point', coordinates: [1, 91] }, properties: { label: 'invalid' } },
    { geometry: { type: 'Polygon', coordinates: [1, 43] }, properties: { label: 'invalid' } },
    { geometry: { type: 'Point', coordinates: [1, 43] }, properties: {} }];
  assert.deepEqual(await searchAddresses('Toulouse', { fetcher: async () => ({ ok: true, json: async () => ({ features }) }) }), []);
});

test('HTTP, invalid response and network errors provide a recoverable message', async () => {
  for (const fetcher of [async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({}) }), async () => { throw new Error('network'); }])
    await assert.rejects(() => searchAddresses('Toulouse', { fetcher }), /indisponible|coordonnées/);
});
