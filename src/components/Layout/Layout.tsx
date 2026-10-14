import type { ReactNode } from 'react';

export function Layout({ children, mode, onHome, mapMode = false, locked = false }: { children: ReactNode; mode: string; onHome: () => void; mapMode?: boolean; locked?: boolean }) {
  return <div className={`app-layout ${mapMode ? 'map-layout' : ''}`}><header className="app-header"><button className="brand" disabled={locked} onClick={onHome} aria-label="Retour à l’accueil"><span className="brand-mark">G</span><span>DISPOSITIF DRONES<small>Gendarmerie · Hackathon</small></span></button><span className="header-mode">{mode}</span><span className="simulation-badge">SIMULATION</span></header><main className={mapMode ? 'map-main' : ''}>{children}</main>{!mapMode && <footer>Prototype d’aide à la décision · Aucune commande réelle envoyée aux drones.</footer>}</div>;
}
