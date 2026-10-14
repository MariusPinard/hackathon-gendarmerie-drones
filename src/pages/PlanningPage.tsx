import { useMission } from '../app/AppContext';
import { PlanningMap } from '../components/Map/PlanningMap';

export function PlanningPage() {
  const { mission } = useMission();
  return <section>
    <h2>Planification</h2>
    <p>Carte minimale centrée sur la mission d’exemple. Dessin, satellite, météo et estimation à venir.</p>
    <PlanningMap center={mission.location} />
  </section>;
}
