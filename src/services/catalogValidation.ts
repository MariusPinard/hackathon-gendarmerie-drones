import type { DroneModel } from '../types/drone';

type JsonObject = Record<string, unknown>;
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);

/** Portable plain data only: prevents prototype-bearing values, cycles and unsafe JSON keys. */
export function validateJsonData(value: unknown): void {
  const ancestors = new Set<object>();
  const visit = (item: unknown, depth: number) => {
    if (item === null || item === undefined || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error('Nombre de données invalide.');
      return;
    }
    if (typeof item !== 'object') throw new Error('Valeur de données non portable.');
    if (depth > 64 || ancestors.has(item)) throw new Error('Structure de données trop profonde ou cyclique.');
    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
      throw new Error('Objet de données invalide.');
    ancestors.add(item);
    for (const key of Object.keys(item)) {
      if (unsafeKeys.has(key)) throw new Error('Clé de données interdite.');
      visit((item as JsonObject)[key], depth + 1);
    }
    ancestors.delete(item);
  };
  visit(value, 0);
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Objet de catalogue invalide.');
  return value as JsonObject;
}

const scenarios: Readonly<Record<string, readonly [string, string, number | null]>> = Object.freeze({
  'tp1-in-sight': ['TP1', 'in_sight', 500],
  'tp1-out-of-sight': ['TP1', 'out_of_sight', 1000],
  'tp2-out-of-sight': ['TP2', 'out_of_sight', 2000],
});

/** Runtime validation for portable mission catalogs and locally saved defaults. */
export function validateDroneCatalog(value: unknown): asserts value is DroneModel[] {
  validateJsonData(value);
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error('Catalogue : 1 à 20 modèles attendus.');
  const ids = new Set<string>();
  for (const valueModel of value) {
    const model = object(valueModel);
    if (typeof model.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(model.id)
      || unsafeKeys.has(model.id) || ids.has(model.id)) throw new Error('Identifiant de modèle invalide ou en double.');
    ids.add(model.id);
    if (typeof model.name !== 'string' || !model.name.trim() || model.name.length > 120
      || typeof model.incompatibleWithRain !== 'boolean' || (model.nightCapable !== undefined && typeof model.nightCapable !== 'boolean'))
      throw new Error('Nom ou compatibilité du drone invalide.');
    const wind = model.windResistanceMetersPerSecond;
    if (wind !== undefined && (typeof wind !== 'number' || !Number.isFinite(wind) || wind < 0 || wind > 50))
      throw new Error('Tenue au vent : valeur attendue de 0 à 50 m/s.');
    for (const key of ['zoom', 'manufacturerRainProtection', 'specificationSource']) {
      const characteristic = model[key];
      if (characteristic !== undefined && (typeof characteristic !== 'string' || characteristic.length > 500))
        throw new Error('Caractéristique du drone invalide.');
    }
    if (model.specificationSource !== undefined) {
      const source = model.specificationSource as string;
      let url: URL;
      try { url = new URL(source); } catch { throw new Error('Source constructeur : URL HTTPS attendue.'); }
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || source !== source.trim()
        || /[\u0000-\u0020\u007f]/.test(source)) throw new Error('Source constructeur : URL HTTPS attendue.');
    }
    if (!Array.isArray(model.capabilities) || !model.capabilities.length || model.capabilities.length > 3)
      throw new Error('Scénarios du drone invalides.');
    const capabilityIds = new Set<string>();
    for (const valueCapability of model.capabilities) {
      const capability = object(valueCapability);
      const expected = typeof capability.id === 'string' && Object.hasOwn(scenarios, capability.id) ? scenarios[capability.id] : undefined;
      // Old embedded 1.0 catalogs left the in-sight range unspecified; preserve them on import.
      const legacyUnspecifiedRange = capability.id === 'tp1-in-sight' && capability.rangeMeters === null;
      if (!expected || typeof capability.id !== 'string' || capabilityIds.has(capability.id)
        || capability.pilotQualification !== expected[0] || capability.flightMode !== expected[1]
        || (capability.rangeMeters !== expected[2] && !legacyUnspecifiedRange))
        throw new Error('Portée ou scénario du drone invalide.');
      capabilityIds.add(capability.id);
      const ceilings = object(capability.maxAltitudeMetersAgl);
      for (const environment of ['rural', 'urban']) {
        const ceiling = ceilings[environment];
        if (typeof ceiling !== 'number' || !Number.isFinite(ceiling) || ceiling <= 0 || ceiling > 120)
          throw new Error('Plafond du drone invalide.');
      }
    }
  }
}
