export function HomePage({ onPlan, onLaunch }: { onPlan: () => void; onLaunch: () => void }) {
  return <section className="home">
    <div className="home-hero">
      <p className="eyebrow"><span aria-hidden="true" /> CARTOGRAPHIE OPÉRATIONNELLE · MULTI-DRONES</p>
      <h1>Planification et coordination<br />d’opérations drones</h1>
      <p className="home-intro">Outil d’aide à la décision pour la préparation<br className="desktop-break" /> et la conduite d’opérations multi-drones.</p>
      <div className="home-actions"><button className="primary" onClick={onPlan}>Planifier une mission <span aria-hidden="true">→</span></button><button onClick={onLaunch}>Lancer une opération <span aria-hidden="true">→</span></button></div>
      <div className="home-capabilities" aria-label="Fonctions du prototype">
        <div><span className="step-number">01</span><h2>Planifier</h2><p>Dimensionnement et couverture</p></div>
        <div><span className="step-number">02</span><h2>Coordonner</h2><p>Drones et télépilotes</p></div>
        <div><span className="step-number">03</span><h2>Recalculer</h2><p>Adaptation en opération</p></div>
      </div>
      <p className="home-disclaimer">Données et résultats de simulation. Le prototype ne valide pas une opération aéronautique réelle.</p>
    </div>
  </section>;
}
