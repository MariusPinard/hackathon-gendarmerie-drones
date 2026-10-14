import { DRONE_CATALOG } from '../data/droneCatalog.ts';
import { DEFAULT_MISSION_CONSTRAINTS } from '../types/mission.ts';
import type { MissionConstraints } from '../types/mission';
import type { DroneModel } from '../types/drone';
import { validateDroneCatalog, validateJsonData } from './catalogValidation.ts';

export interface PlannerPreferences { catalog: DroneModel[]; constraints: MissionConstraints }
const KEY = 'drone-planner-preferences-v1';
export function readPlannerPreferences(): PlannerPreferences {
  const fallback = { catalog: structuredClone(DRONE_CATALOG) as DroneModel[], constraints: { ...DEFAULT_MISSION_CONSTRAINTS } };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    validateJsonData(parsed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    const value = parsed as Record<string, unknown>;
    if (!Array.isArray(value.customModels) || typeof value.separation !== 'number' || !Number.isFinite(value.separation) || value.separation < 10 || value.separation > 120
      || typeof value.overlap !== 'number' || !Number.isFinite(value.overlap) || value.overlap < 0 || value.overlap > 100) return fallback;
    const catalog = [...fallback.catalog, ...value.customModels];
    validateDroneCatalog(catalog);
    return { catalog, constraints: { ...fallback.constraints, minimumVerticalSeparationMeters: value.separation, maximumOverlapPercent: value.overlap } };
  } catch { return fallback; }
}
export function savePlannerPreferences(preferences: PlannerPreferences): void {
  validateJsonData(preferences);
  validateDroneCatalog(preferences.catalog);
  const separation = preferences.constraints.minimumVerticalSeparationMeters, overlap = preferences.constraints.maximumOverlapPercent ?? 20;
  if (!Number.isFinite(separation) || separation < 10 || separation > 120 || !Number.isFinite(overlap) || overlap < 0 || overlap > 100) throw new Error('Paramètres invalides.');
  const customModels = preferences.catalog.filter(m => !DRONE_CATALOG.some(original => original.id === m.id));
  validateDroneCatalog([...DRONE_CATALOG, ...customModels]);
  try { localStorage.setItem(KEY, JSON.stringify({ separation, overlap, customModels })); }
  catch { /* In-memory preferences remain available when browser storage is blocked. */ }
}
