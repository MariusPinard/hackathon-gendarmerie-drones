import type { ReactNode } from 'react';

export function Layout({ children, mode, onHome }: { children: ReactNode; mode: string; onHome: () => void }) {
  return <><header className="app-header"><button className="brand" onClick={onHome}><span className="brand-mark">G</span><span>DISPOSITIF DRONES<small>Gendarmerie · Hackathon</small></span></button><span className="header-mode">{mode}</span><span className="simulation-badge">SIMULATION</span></header><main>{children}</main><footer>Prototype d’aide à la décision · Aucune commande réelle envoyée aux drones.</footer></>;
}
