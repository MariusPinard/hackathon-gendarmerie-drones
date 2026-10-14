import { useState } from 'react';
import { useMission } from '../app/AppContext';
import { importMission, parseMission } from '../services/missionStorage';
import exampleMission from '../data/exampleMission.json';
import type { Mission } from '../types/mission';

export function ImportPage({ onImported }: { onImported: () => void }) {
  const { setMission, setDraftAuthorization } = useMission();
  const [json, setJson] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  function accept(mission: Mission) { setMission(mission); setDraftAuthorization(mission.constraints.authorization); setError(''); onImported(); }
  function parse() { try { if (json.length > 2000000) throw new Error('JSON trop volumineux (maximum 2 Mo).'); accept(parseMission(json)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Mission JSON invalide.'); } }
  return <section className="import-page"><p className="eyebrow">IMPORT MISSION</p><h1>Reprendre une mission</h1><p>Importez un JSON 1.0 puis vérifiez les ressources disponibles avant de lancer la simulation.</p>
    <div className="panel">{error && <p role="alert" className="notice error">{error}</p>}
      <label>Fichier mission JSON<input type="file" accept=".json,application/json" disabled={loading} onChange={async e => {
        const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (!file) return;
        setLoading(true); try { accept(await importMission(file)); } catch (err) { setError(err instanceof Error ? err.message : 'Import impossible.'); } finally { setLoading(false); }
      }} /></label>
      <details><summary>Ou coller un JSON</summary><label>Contenu JSON<textarea value={json} onChange={e => setJson(e.target.value)} rows={8} spellCheck={false} /></label><button className="primary" onClick={parse}>Importer le JSON</button></details>
      <p className="muted">Sans fichier pour la démonstration ? Chargez un scénario fictif de Rennes.</p>
      <button onClick={() => { try { accept(parseMission(JSON.stringify(exampleMission))); } catch (err) { setError(err instanceof Error ? err.message : 'Exemple invalide.'); } }}>Charger la mission de démonstration</button>
    </div></section>;
}
