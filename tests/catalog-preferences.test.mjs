import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRONE_CATALOG, DRONE_CAPABILITIES } from '../src/data/droneCatalog.ts';
import { DEFAULT_MISSION_CONSTRAINTS } from '../src/types/mission.ts';
import { validateDroneCatalog } from '../src/services/catalogValidation.ts';
import { readPlannerPreferences, savePlannerPreferences } from '../src/services/plannerPreferences.ts';

const custom = () => ({ id: 'custom-01', name: 'Drone ajouté', incompatibleWithRain: false,
  nightCapable: true, windResistanceMetersPerSecond: 15, zoom: '5× optique',
  capabilities: structuredClone(DRONE_CAPABILITIES) });
const defaults = () => ({ catalog: structuredClone(DRONE_CATALOG), constraints: { ...DEFAULT_MISSION_CONSTRAINTS } });
const key = 'drone-planner-preferences-v1';

function storageFor(t, storage) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; });
}

test('built-in catalog and optional custom characteristics validate without mutation', () => {
  const catalog = [...structuredClone(DRONE_CATALOG), custom()];
  const before = structuredClone(catalog);
  validateDroneCatalog(catalog);
  assert.deepEqual(catalog, before);
  const legacy = { id: 'legacy-custom', name: 'Legacy', incompatibleWithRain: true, capabilities: [structuredClone(DRONE_CAPABILITIES[1])] };
  assert.doesNotThrow(() => validateDroneCatalog([legacy]));
});

test('catalog rejects duplicate/unsafe ids, invalid characteristics and unbounded capabilities', () => {
  const mutations = [
    m => { m.id = 'constructor'; }, m => { m.id = 'prototype'; }, m => { m.id = '__proto__'; },
    m => { m.name = ' '; }, m => { m.nightCapable = 'yes'; }, m => { m.incompatibleWithRain = 0; },
    m => { m.windResistanceMetersPerSecond = -1; }, m => { m.windResistanceMetersPerSecond = 51; },
    m => { m.windResistanceMetersPerSecond = Infinity; }, m => { m.zoom = 'x'.repeat(501); },
    m => { m.capabilities = []; }, m => { m.capabilities.push(structuredClone(m.capabilities[0])); },
    m => { m.capabilities[1].rangeMeters = 999; }, m => { m.capabilities[0].rangeMeters = 501; },
    m => { m.capabilities[0].id = 'constructor'; }, m => { m.capabilities[1].pilotQualification = 'TP2'; },
    m => { m.capabilities[1].maxAltitudeMetersAgl.urban = 121; },
    m => { m.capabilities[1].maxAltitudeMetersAgl.rural = 0; },
  ];
  for (const mutate of mutations) { const model = custom(); mutate(model); assert.throws(() => validateDroneCatalog([model])); }
  assert.throws(() => validateDroneCatalog([custom(), custom()]), /double/);
  assert.throws(() => validateDroneCatalog(Array.from({ length: 21 }, (_, i) => ({ ...custom(), id: `custom-${i}` }))), /20/);
  assert.throws(() => validateDroneCatalog([Object.create(custom())]), /Objet/);
});

test('in-sight catalog range accepts current 500 m and legacy unspecified null only', () => {
  for (const rangeMeters of [500, null]) {
    const model = custom(); model.capabilities[0].rangeMeters = rangeMeters;
    assert.doesNotThrow(() => validateDroneCatalog([model]));
    assert.equal(model.capabilities[0].rangeMeters, rangeMeters);
  }
  for (const rangeMeters of [0, 499, 501, 1000, undefined]) {
    const model = custom(); model.capabilities[0].rangeMeters = rangeMeters;
    assert.throws(() => validateDroneCatalog([model]), /Portée/);
  }
});

test('catalog sources accept HTTPS and reject executable, relative, credential or control URLs', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '//example.org/specs', '/specs', 'http://example.org/specs',
    'https://user:secret@example.org', ' https://example.org', 'https://example.org/\ntext']) {
    const model = { ...custom(), specificationSource: url };
    assert.throws(() => validateDroneCatalog([model]), /HTTPS/);
  }
  assert.doesNotThrow(() => validateDroneCatalog([{ ...custom(), specificationSource: 'https://example.org/sp%C3%A9cifications?version=1' }]));
});

test('pollution keys and cycles are rejected in catalog data', () => {
  const model = custom();
  model.extra = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => validateDroneCatalog([model]), /interdite/);
  const cyclic = custom(); cyclic.extra = cyclic;
  assert.throws(() => validateDroneCatalog([cyclic]), /cyclique/);
  assert.equal({}.polluted, undefined);
});

test('missing, blocked, corrupt or invalid preference storage gives fresh current defaults', t => {
  let raw = null;
  storageFor(t, { getItem: requested => { assert.equal(requested, key); return raw; } });
  const invalidValues = [null, '{', 'null', '[]', JSON.stringify({ separation: 9, overlap: 20, customModels: [] }),
    JSON.stringify({ separation: 30, overlap: 101, customModels: [] }),
    JSON.stringify({ separation: 30, overlap: 20, customModels: [DRONE_CATALOG[0]] }),
    '{"separation":30,"overlap":20,"customModels":[],"__proto__":{"polluted":true}}'];
  for (const value of invalidValues) { raw = value; assert.deepEqual(readPlannerPreferences(), defaults()); }
  const first = readPlannerPreferences(); first.catalog[0].name = 'mutated'; first.constraints.minimumVerticalSeparationMeters = 99;
  assert.deepEqual(readPlannerPreferences(), defaults());
  globalThis.localStorage.getItem = () => { throw new Error('blocked'); };
  assert.deepEqual(readPlannerPreferences(), defaults());
});

test('preferences round-trip custom models and numeric settings while refreshing built-ins', t => {
  let raw;
  storageFor(t, { getItem: () => raw ?? null, setItem: (requested, value) => { assert.equal(requested, key); raw = value; } });
  const preferences = defaults();
  preferences.catalog[0].name = 'Old locally modified manufacturer name';
  preferences.catalog.push(custom());
  preferences.constraints.minimumVerticalSeparationMeters = 45;
  preferences.constraints.maximumOverlapPercent = 12.5;
  savePlannerPreferences(preferences);
  assert.deepEqual(JSON.parse(raw).customModels, [custom()]);
  const restored = readPlannerPreferences();
  assert.deepEqual(restored.catalog, [...structuredClone(DRONE_CATALOG), custom()]);
  assert.equal(restored.constraints.minimumVerticalSeparationMeters, 45);
  assert.equal(restored.constraints.maximumOverlapPercent, 12.5);
  assert.equal(restored.catalog[0].manufacturerRainProtection, DRONE_CATALOG[0].manufacturerRainProtection);
});

test('preference writes validate before storage and tolerate browser quota failure', t => {
  let calls = 0;
  storageFor(t, { setItem: () => { calls++; throw new Error('quota'); } });
  const invalid = defaults(); invalid.constraints.maximumOverlapPercent = -1;
  assert.throws(() => savePlannerPreferences(invalid), /Paramètres/); assert.equal(calls, 0);
  assert.doesNotThrow(() => savePlannerPreferences(defaults())); assert.equal(calls, 1);
});

test('authorization stays in the current mission and is not saved as a default preference', t => {
  let raw;
  storageFor(t, { getItem: () => raw ?? null, setItem: (_requested, value) => { raw = value; } });
  const preferences = defaults();
  preferences.constraints.authorization = { reference: 'Arrêté de test', maximumDrones: 3,
    startAt: '2026-10-15T08:00:00Z', endAt: '2026-10-15T10:00:00Z' };
  savePlannerPreferences(preferences);
  assert.equal(JSON.parse(raw).authorization, undefined);
  assert.equal(readPlannerPreferences().constraints.authorization, undefined);
  assert.equal(preferences.constraints.authorization.reference, 'Arrêté de test');
});
