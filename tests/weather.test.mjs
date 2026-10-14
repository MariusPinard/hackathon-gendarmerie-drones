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
test('forecast reports dry or rain including convective showers, with local solar day/night', async () => {
  const dry = await getWeather(48, -1, date, { now, fetcher: fetcher() });
  assert.equal(dry.rainDetected, false); assert.equal(dry.dayNight, 'day');
  assert.equal((await getWeather(48, -1, date, { now, fetcher: fetcher(0, 0.1) })).rainDetected, true);
});
test('forecast outside horizon does not call network but still calculates day/night', async () => {
  const fail = async () => { throw new Error('must not fetch'); };
  for (const dateTime of ['2020-01-01T00:00:00Z','2099-01-01T00:00:00Z']) {
    const result = await getWeather(48, -1, dateTime, { now, fetcher: fail });
    assert.equal(result.status, 'unavailable'); assert.equal(result.rainDetected, null);
    assert.equal(result.dayNight, 'night');
  }
});
test('null, missing interval, HTTP and network errors preserve unknown forecast', async () => {
  const cases = [fetcher(null), async () => ({ ok: false }), async () => { throw new Error('offline'); },
    async () => ({ ok: true, json: async () => ({ hourly: { time: [], rain: [], showers: [] } }) })];
  for (const fetch of cases) {
    const result = await getWeather(48, -1, date, { now, fetcher: fetch });
    assert.equal(result.status, 'unavailable'); assert.equal(result.rainDetected, null);
    assert.equal(result.dayNight, 'day');
  }
});
test('invalid coordinates or ISO calendar date stay unknown without fetching', async () => {
  const fail = async () => { throw new Error('must not fetch'); };
  for (const [latitude, longitude, dateTime] of [[91, 1, date], [43, 181, date], [NaN, 1, date],
    [43, 1, '2026-02-30T12:00:00Z'], [43, 1, '2026-10-15T12:00']]) {
    const result = await getWeather(latitude, longitude, dateTime, { now, fetcher: fail });
    assert.equal(result.status, 'unavailable'); assert.equal(result.rainDetected, null);
    assert.equal(result.dayNight, 'unknown');
  }
});
test('caller abort is combined with timeout and solar night is preserved', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await getWeather(43, 1, '2026-10-15T00:00:00Z', { now, signal: controller.signal,
    fetcher: async (_url, { signal }) => { assert.equal(signal.aborted, true); throw new Error('cancelled'); } });
  assert.equal(result.status, 'unavailable'); assert.equal(result.rainDetected, null);
  assert.equal(result.dayNight, 'night');
});
