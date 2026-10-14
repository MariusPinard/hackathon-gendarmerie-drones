import type { ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';

export function Layout({ children, mode, onHome, mapMode = false, locked = false }: { children: ReactNode; mode: string; onHome: () => void; mapMode?: boolean; locked?: boolean }) {
  return <div className={`app-layout ${mapMode ? 'map-layout' : ''} ${mode === 'ACCUEIL' ? 'home-layout' : ''}`}>
    <header className="app-header">
      <button className="brand" disabled={locked} onClick={onHome} aria-label="Retour à l’accueil">
        <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="m4 9 8-4 8 4 8-4v19l-8 4-8-4-8 4Z" /><path d="M12 5v19M20 9v19" /><circle cx="20" cy="14" r="3" /></svg></span>
        <span>PLANIFICATION DRONES<small>Préparation & coordination · Hackathon</small></span>
      </button>
      <span className="header-mode">{mode}</span><span className="simulation-badge">SIMULATION</span><ThemeToggle disabled={locked} />
    </header>
    <main className={mapMode ? 'map-main' : ''}>{children}</main>
    {!mapMode && <footer>Prototype d’aide à la décision · Aucune commande réelle envoyée aux drones.</footer>}
  </div>;
}
