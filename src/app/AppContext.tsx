import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Mission, MissionConstraints } from '../types/mission';
import type { DroneModel } from '../types/drone';
import { readPlannerPreferences, savePlannerPreferences } from '../services/plannerPreferences';
import { advanceSimulation } from '../engines/operations';

interface AppState {
  draftAuthorization: MissionConstraints['authorization'];
  setDraftAuthorization: (authorization: MissionConstraints['authorization']) => void;
  catalog: DroneModel[];
  defaultConstraints: MissionConstraints;
  setPreferences: (catalog: DroneModel[], constraints: MissionConstraints) => void;
  mission: Mission | null;
  setMission: (mission: Mission | null) => void;
  navigationLocked: boolean;
  setNavigationLocked: (locked: boolean) => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferencesState] = useState(readPlannerPreferences);
  const [draftAuthorization, setDraftAuthorization] = useState<MissionConstraints['authorization']>(undefined);
  const setPreferences = (catalog: DroneModel[], constraints: MissionConstraints) => { const { authorization: _authorization, ...defaults } = constraints; void _authorization; savePlannerPreferences({ catalog, constraints: defaults }); setPreferencesState({ catalog, constraints: defaults }); };
  const [mission, setMission] = useState<Mission | null>(null);
  const [navigationLocked, setNavigationLocked] = useState(false);
  const status = mission?.status;
  useEffect(() => {
    if (!mission || !['returning', 'emergency'].includes(mission.status)
      || !mission.drones.some(d => d.status === 'returning' || d.status === 'emergency_landing')) return;
    const initial = structuredClone(mission), started = performance.now();
    const timer = setInterval(() => {
      const progress = Math.min(1, (performance.now() - started) / 4000);
      const next = advanceSimulation(initial, progress).mission;
      next.metadata.updatedAt = new Date().toISOString();
      setMission(current => current && current.metadata.id === initial.metadata.id && current.status === initial.status ? { ...current, drones: next.drones, pilots: next.pilots, status: next.status, metadata: { ...current.metadata, updatedAt: next.metadata.updatedAt } } : current);
      if (progress === 1) clearInterval(timer);
    }, 150);
    return () => clearInterval(timer);
  }, [status]);
  return <AppContext.Provider value={{ mission, setMission, navigationLocked, setNavigationLocked, draftAuthorization, setDraftAuthorization, catalog: preferences.catalog, defaultConstraints: preferences.constraints, setPreferences }}>{children}</AppContext.Provider>;
}

export function useMission(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error('useMission doit être utilisé dans AppProvider.');
  return context;
}
