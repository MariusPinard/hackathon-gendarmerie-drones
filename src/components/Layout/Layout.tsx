import type { ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';

export function Layout({ children, mode, onHome, onSettings, mapMode = false, locked = false }: { children: ReactNode; mode: string; onHome: () => void; onSettings?: () => void; mapMode?: boolean; locked?: boolean }) {
  return <div className={`app-layout ${mapMode ? 'map-layout' : ''} ${mode === 'ACCUEIL' ? 'home-layout' : ''}`}>
    <header className="app-header">
      <button className="brand" disabled={locked} onClick={onHome} aria-label="Retour à l’accueil">
        <span className="brand-mark brand-shield" aria-hidden="true">G</span>
        <span>DISPOSITIF DRONES<small>Gendarmerie · Hackathon</small></span>
      </button>
      <span className="header-mode">{mode}</span><span className="simulation-badge">SIMULATION</span>{onSettings && <button className="settings-toggle" disabled={locked} aria-label="Paramètres" title="Paramètres" onClick={onSettings}><span aria-hidden="true">⚙</span></button>}<ThemeToggle disabled={locked} />
    </header>
    <main className={mapMode ? 'map-main' : ''}>{children}</main>
    {!mapMode && <footer>Prototype d’aide à la décision · Aucune commande réelle envoyée aux drones.</footer>}
  </div>;
}
