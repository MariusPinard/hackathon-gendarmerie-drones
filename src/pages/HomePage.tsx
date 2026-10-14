export function HomePage({ onPlan, onLaunch }: { onPlan: () => void; onLaunch: () => void }) {
  return <section className="operations-home">
    <div className="home-command-header">
      <div className="home-command-intro">
        <div className="institution-signature"><img src="/image/gendarmerie-transparent.png" alt="Gendarmerie nationale — Une force humaine" /></div>
        <p className="eyebrow">COORDINATION DES MOYENS AÉRIENS</p>
        <h1>Espace opérationnel</h1>
        <p className="home-command-description">Préparer la mission.<br /> Coordonner le dispositif sur le terrain.</p>
        <span className="console-status"><i /> Environnement de simulation</span>
      </div>
      <img className="home-division-logo" src="/image/division-drone-transparent.png" alt="Division Drone — Planifier et coordonner" />
    </div>
    <div className="console-panel-heading home-access-heading"><h2>Accès aux missions</h2><span>Préparation et conduite</span></div>
    <div className="mission-access-grid">
      <button className="mission-entry" onClick={onPlan}><span className="entry-symbol" aria-hidden="true">◇</span><span className="entry-content"><small className="entry-category">PLANIFICATEUR</small><strong>Préparer une mission</strong><small>Définir les zones, évaluer la couverture et adapter les ressources.</small></span><span className="entry-action">Ouvrir le planificateur <b aria-hidden="true">→</b></span></button>
      <button className="mission-entry" onClick={onLaunch}><span className="entry-symbol" aria-hidden="true">↥</span><span className="entry-content"><small className="entry-category">CONDUITE</small><strong>Reprendre une mission</strong><small>Importer un dispositif, vérifier les moyens et lancer l’opération.</small></span><span className="entry-action">Importer une mission <b aria-hidden="true">→</b></span></button>
    </div>
    <div className="home-tools-note"><span aria-hidden="true">⌖</span><p><strong>Une carte pour préparer et coordonner</strong><br />Zones de travail, occupation du terrain, télépilotes et flotte réunis dans le même espace.</p></div>
  </section>;
}
