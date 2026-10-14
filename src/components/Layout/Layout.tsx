import type { ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';

export function Layout({ children, mode, onHome, mapMode = false, locked = false }: { children: ReactNode; mode: string; onHome: () => void; mapMode?: boolean; locked?: boolean }) {
  return <div className={`app-layout ${mapMode ? 'map-layout' : ''} ${mode === 'ACCUEIL' ? 'home-layout' : ''}`}>
    <header className="app-header">
      <button className="brand" disabled={locked} onClick={onHome} aria-label="Retour à l’accueil">
        <img className="brand-logo" src="/image/gendarmerie-transparent.png" alt="Gendarmerie nationale" />
        <span>DIVISION DRONE - GENDARMERIE<small>Coordination opérationnelle</small></span>
      </button>
      <span className="header-mode">{mode}</span><span className="simulation-badge">SIMULATION</span><img className="division-header-logo" src="/image/division-drone-transparent.png" alt="Division Drone" /><ThemeToggle disabled={locked} />
    </header>
    <main className={mapMode ? 'map-main' : ''}>{children}</main>
    {!mapMode && <footer>Prototype d’aide à la décision · Aucune commande réelle envoyée aux drones.</footer>}
  </div>;
}
