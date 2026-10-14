import { useState } from 'react';
import { DRONE_CAPABILITIES } from '../../data/droneCatalog';
import type { DroneModel } from '../../types/drone';

export function CustomDroneForm({ onAdd, onCancel }: { onAdd: (model: DroneModel) => void; onCancel: () => void }) {
  const [name, setName] = useState(''), [rain, setRain] = useState(false), [night, setNight] = useState(false);
  const [wind, setWind] = useState(''), [zoom, setZoom] = useState(''), [error, setError] = useState('');
  return <form className="custom-drone-form" onSubmit={event => { event.preventDefault(); try {
    if (!name.trim()) throw new Error('Indiquez le nom du drone.');
    const value = wind.trim() ? Number(wind) : undefined;
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 50)) throw new Error('Tenue au vent : 0 à 50 m/s.');
    onAdd({ id: `custom-${crypto.randomUUID()}`, name: name.trim(), incompatibleWithRain: !rain, nightCapable: night,
      ...(value !== undefined ? { windResistanceMetersPerSecond: value } : {}), zoom: zoom.trim() || 'Non renseigné',
      manufacturerRainProtection: 'Modèle ajouté par l’utilisateur : caractéristiques à vérifier.', capabilities: structuredClone(DRONE_CAPABILITIES) });
  } catch (failure) { setError(failure instanceof Error ? failure.message : 'Ajout impossible.'); } }}>
    <h3>Ajouter un modèle de drone</h3><label>Nom du drone<input value={name} maxLength={120} onChange={e => setName(e.target.value)} required /></label>
    <div className="field-row"><label>Compatible pluie<select value={rain ? 'yes' : 'no'} onChange={e => setRain(e.target.value === 'yes')}><option value="no">Non</option><option value="yes">Oui</option></select></label>
    <label>Vue nocturne<select value={night ? 'yes' : 'no'} onChange={e => setNight(e.target.value === 'yes')}><option value="no">Non</option><option value="yes">Oui</option></select></label></div>
    <div className="field-row"><label>Tenue au vent (m/s)<input type="number" min={0} max={50} step="0.1" value={wind} onChange={e => setWind(e.target.value)} placeholder="Non renseignée" /></label><label>Zoom<input value={zoom} maxLength={100} onChange={e => setZoom(e.target.value)} placeholder="Ex. optique 3×" /></label></div>
    <p className="muted">Compatibilités déclarées pour la simulation ; vérifiez la fiche constructeur avant tout usage réel.</p>
    {error && <p role="alert" className="notice error">{error}</p>}
    <div className="actions"><button type="button" onClick={onCancel}>Annuler</button><button className="primary">Ajouter le drone</button></div>
  </form>;
}
