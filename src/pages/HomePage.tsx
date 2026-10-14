export function HomePage({ onPlan, onLaunch }: { onPlan: () => void; onLaunch: () => void }) {
  return <section className="operations-home">
    <div className="console-heading"><div><p className="eyebrow">GENDARMERIE NATIONALE · DISPOSITIF DRONES</p><h1>Espace opérationnel</h1><p className="muted">Préparation des missions et conduite du dispositif.</p></div><span className="console-status"><i /> Environnement de simulation</span></div>
    <div className="console-panel"><div className="console-panel-heading"><h2>Accès aux missions</h2><span>Choisissez une action</span></div>
      <button className="mission-entry" onClick={onPlan}><span className="entry-symbol" aria-hidden="true">◇</span><span><strong>Préparer une mission</strong><small>Définir la zone, estimer les moyens et ajuster le dispositif.</small></span><span className="entry-action">Ouvrir le planificateur <b aria-hidden="true">→</b></span></button>
      <button className="mission-entry" onClick={onLaunch}><span className="entry-symbol" aria-hidden="true">↥</span><span><strong>Reprendre une mission</strong><small>Importer un fichier mission pour vérifier les ressources et lancer l’opération.</small></span><span className="entry-action">Importer une mission <b aria-hidden="true">→</b></span></button>
    </div>
    <div className="console-note"><strong>Conduite de l’opération</strong><p>La carte regroupe les zones de travail, les télépilotes, la flotte et les alertes. Les paramètres de calcul sont accessibles dans le planificateur.</p></div>
  </section>;
}
