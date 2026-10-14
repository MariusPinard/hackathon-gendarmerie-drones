export function HomePage({ onPlan, onLaunch }: { onPlan: () => void; onLaunch: () => void }) {
  return <section>
    <h2>Accueil</h2>
    <p>Fondation technique : les moteurs métier et les workflows seront développés ultérieurement.</p>
    <button onClick={onPlan}>Planifier une mission</button>
    <button onClick={onLaunch}>Lancer une opération</button>
  </section>;
}
