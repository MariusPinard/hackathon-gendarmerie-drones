import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { Mission } from '../types/mission';

interface AppState {
  mission: Mission | null;
  setMission: (mission: Mission | null) => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [mission, setMission] = useState<Mission | null>(null);
  return <AppContext.Provider value={{ mission, setMission }}>{children}</AppContext.Provider>;
}

export function useMission(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error('useMission doit être utilisé dans AppProvider.');
  return context;
}
