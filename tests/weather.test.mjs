import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWeather } from '../src/services/weather.ts';
const now = Date.parse('2026-10-14T08:00:00Z');
const date = '2026-10-15T10:30:00+02:00';
const endpoint = Math.ceil(Date.parse(date) / 3600000) * 3600;
function fetcher(rain = 0, showers = 0) { return async url => {
  assert.equal(url.hostname, 'api.open-meteo.com');
  assert.equal(url.searchParams.get('timeformat'), 'unixtime');
  return { ok: true, json: async () => ({ hourly: { time: [endpoint], rain: [rain], showers: [showers] } }) };
}; }
test('forecast reports dry or rain including convective showers, without arbitrary night rules', async () => {
  const dry = await getWeather(48, -1, date, { now, fetcher: fetcher() });
  assert.equal(dry.rainDetected, false); assert.equal(dry.dayNight, 'unknown');
  assert.equal((await getWeather(48, -1, date, { now, fetcher: fetcher(0, 0.1) })).rainDetected, true);
});
test('forecast outside horizon does not call network', async () => {
  const fail = async () => { throw new Error('must not fetch'); };
  for (const dateTime of ['2020-01-01T00:00:00Z','2099-01-01T00:00:00Z'])
    assert.equal((await getWeather(48, -1, dateTime, { now, fetcher: fail })).status, 'unavailable');
});
test('null, missing interval, HTTP and network errors preserve unknown forecast', async () => {
  const cases = [fetcher(null), async () => ({ ok: false }), async () => { throw new Error('offline'); },
    async () => ({ ok: true, json: async () => ({ hourly: { time: [], rain: [], showers: [] } }) })];
  for (const fetch of cases) {
    const result = await getWeather(48, -1, date, { now, fetcher: fetch });
    assert.equal(result.status, 'unavailable'); assert.equal(result.rainDetected, null);
  }
});
