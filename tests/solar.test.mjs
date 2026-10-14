import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDayNight, parseSolarInstant, solarElevationDegrees } from '../src/services/solar.ts';

test('solar elevation agrees with independent NREL SPA published example', () => {
  // NREL/TP-560-34302, Table A5.1: corrected zenith = 50.11162 degrees.
  // https://www.nlr.gov/docs/fy08osti/34302.pdf (Golden CO, 17 October 2003, 12:30:30 MST).
  // NOAA geometric elevation omits SPA's topocentric/refraction corrections: allow 0.05°.
  const elevation = solarElevationDegrees(39.742476, -105.1786, '2003-10-17T12:30:30-07:00');
  assert.ok(Math.abs(elevation - (90 - 50.11162)) < 0.05, `unexpected elevation ${elevation}`);
});
test('France summer and winter have correct noon, midnight and seasonal twilight', () => {
  for (const date of ['2026-06-21', '2026-12-21']) {
    assert.equal(getDayNight(43.09, 1.87, `${date}T12:00:00Z`), 'day');
    assert.equal(getDayNight(43.09, 1.87, `${date}T00:00:00Z`), 'night');
  }
  assert.equal(getDayNight(43.09, 1.87, '2026-06-21T19:30:00Z'), 'day');
  assert.equal(getDayNight(43.09, 1.87, '2026-12-21T19:30:00Z'), 'night');
  // The solar-disc centre crosses -6° around 20:11 UTC here, after sunset.
  assert.equal(getDayNight(43.09, 1.87, '2026-06-21T20:10:00Z'), 'day');
  assert.equal(getDayNight(43.09, 1.87, '2026-06-21T20:15:00Z'), 'night');
});
test('longitude, southern hemisphere and polar seasons are respected', () => {
  // Sydney at noon and midnight in both seasons; UTC date differs from local date.
  for (const date of ['2026-06-21', '2026-12-21']) {
    assert.equal(getDayNight(-33.87, 151.21, `${date}T12:00:00+10:00`), 'day');
    assert.equal(getDayNight(-33.87, 151.21, `${date}T00:00:00+10:00`), 'night');
  }
  for (const hour of ['00:00', '12:00']) {
    assert.equal(getDayNight(80, 0, `2026-06-21T${hour}:00Z`), 'day');
    assert.equal(getDayNight(80, 0, `2026-12-21T${hour}:00Z`), 'night');
    assert.equal(getDayNight(-80, 0, `2026-06-21T${hour}:00Z`), 'night');
    assert.equal(getDayNight(-80, 0, `2026-12-21T${hour}:00Z`), 'day');
  }
  assert.equal(getDayNight(0, 180, '2026-03-20T00:00:00Z'), 'day');
  assert.equal(getDayNight(0, 180, '2026-03-20T12:00:00Z'), 'night');
});
test('equivalent UTC/offset instants and antimeridian coordinates give the same result', () => {
  const utc = solarElevationDegrees(43.09, 1.87, '2026-06-21T20:30:00Z');
  assert.equal(solarElevationDegrees(43.09, 1.87, '2026-06-21T22:30:00+02:00'), utc);
  assert.equal(solarElevationDegrees(43.09, 1.87, '2026-06-21T13:30:00-07:00'), utc);
  assert.equal(parseSolarInstant('2026-06-20T24:00:00Z'), parseSolarInstant('2026-06-21T00:00:00Z'));
  assert.equal(parseSolarInstant('2026-06-21T00:00:00.123456Z'), parseSolarInstant('2026-06-21T00:00:00.123Z'));
  assert.ok(Math.abs(solarElevationDegrees(0, 180, '2026-03-20T00:00:00Z')
    - solarElevationDegrees(0, -180, '2026-03-20T00:00:00Z')) < 1e-9);
});
test('invalid dates, ambiguous local time and invalid coordinates return unknown', () => {
  for (const date of ['', 'tomorrow', '2026-02-30T12:00:00Z', '2025-02-29T12:00:00Z',
    '2026-13-01T12:00:00Z', '2026-01-01T25:00:00Z', '2026-01-01T24:01:00Z', '2026-01-01T00:61:00Z',
    '2026-01-01T12:00:00+99:00', '2026-01-01', '2026-01-01T12:00:00']) {
    assert.equal(parseSolarInstant(date), null, date);
    assert.equal(getDayNight(43, 1, date), 'unknown', date);
  }
  for (const [lat, lon] of [[91, 0], [-91, 0], [0, 181], [0, -181], [NaN, 0], [0, Infinity]]) {
    assert.equal(solarElevationDegrees(lat, lon, '2026-01-01T12:00:00Z'), null);
    assert.equal(getDayNight(lat, lon, '2026-01-01T12:00:00Z'), 'unknown');
  }
  assert.notEqual(parseSolarInstant('2024-02-29T12:00:00Z'), null);
});
test('valid dates outside the weather horizon and geographic poles remain calculable', () => {
  for (const year of ['1999', '2099']) {
    assert.equal(getDayNight(43.09, 1.87, `${year}-12-21T12:00:00Z`), 'day');
    assert.equal(getDayNight(43.09, 1.87, `${year}-12-21T00:00:00Z`), 'night');
  }
  for (const lat of [-90, 90]) {
    const elevation = solarElevationDegrees(lat, 0, '2024-02-29T12:00:00Z');
    assert.ok(Number.isFinite(elevation) && elevation >= -90 && elevation <= 90);
  }
});
