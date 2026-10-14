import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Mission } from '../types/mission';
import { advanceSimulation } from '../engines/operations';

interface AppState {
  mission: Mission | null;
  setMission: (mission: Mission | null) => void;
  navigationLocked: boolean;
  setNavigationLocked: (locked: boolean) => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
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
      setMission(next);
      if (progress === 1) clearInterval(timer);
    }, 150);
    return () => clearInterval(timer);
  }, [status]);
  return <AppContext.Provider value={{ mission, setMission, navigationLocked, setNavigationLocked }}>{children}</AppContext.Provider>;
}

export function useMission(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error('useMission doit être utilisé dans AppProvider.');
  return context;
}
