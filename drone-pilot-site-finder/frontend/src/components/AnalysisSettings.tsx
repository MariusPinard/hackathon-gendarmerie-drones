import type { AnalysisOptions } from '../types'

export const defaultOptions: AnalysisOptions = {
  search_radius_m: 300, surroundings_only: true, min_area_m2: 100, min_width_m: 5,
  obstacle_buffer_m: 10, max_access_distance_m: 100, max_slope_deg: 12,
  terrain_spacing_m: 10, target_height_agl_m: 30, require_terrain: false,
  use_osm: true, use_ign: true, use_imagery: true, use_lidar: true, use_panoramax: true,
  include_ground:true, include_rooftops:true, roof_edge_setback_m:3, max_roof_slope_deg:8,
  roof_sample_spacing_m:3, roof_shortlist_limit:12,
  include_occupancy: true, pilot_range_m: 1000, occupancy_cell_m: 10,
  weights: { accessibility: .2, area: .15, slope: .2, obstacles: .15, openness: .2, proximity: .1 },
}

export default function AnalysisSettings({options, onChange, disabled}: {
  options: AnalysisOptions; onChange: (options: AnalysisOptions) => void; disabled: boolean
}) {
  const fields: [keyof AnalysisOptions, string, number, number][] = [
    ['search_radius_m', 'Rayon autour du périmètre (m)', 0, 2000],
    ['min_area_m2', 'Surface minimale (m²)', 25, 100000],
    ['min_width_m', 'Largeur minimale (m)', 2, 100],
    ['max_access_distance_m', 'Distance d’accès maximale (m)', 5, 1000],
    ['max_slope_deg', 'Pente maximale estimée (°)', 1, 40],
    ['target_height_agl_m', 'Hauteur cible AGL pour visibilité (m)', 1, 500],
  ]
  return <details className="analysis-settings"><summary>Paramètres de recherche</summary>
    <fieldset disabled={disabled}>
      <div className="range-settings">
        <label>Portée du télépilote
          <select value={[1000, 2000].includes(options.pilot_range_m) ? String(options.pilot_range_m) : 'custom'}
            onChange={event => event.target.value !== 'custom' && onChange({...options, pilot_range_m: Number(event.target.value)})}>
            <option value="1000">TP1 · 1 km</option><option value="2000">TP2 · 2 km</option><option value="custom">Personnalisée</option>
          </select>
        </label>
        <label>Portée (m)<input type="number" min="50" max="5000" step="50" value={options.pilot_range_m} onChange={event => onChange({...options, pilot_range_m: Number(event.target.value)})} /></label>
      </div>
      <label className="checkbox-label"><input type="checkbox" checked={options.include_occupancy} onChange={event => onChange({...options, include_occupancy: event.target.checked})} />Calculer la carte d’occupation au décollage</label>
      <label>Taille des cellules d’occupation (m, agrandie si l’emprise l’exige)<input type="number" min="2" max="50" disabled={!options.include_occupancy} value={options.occupancy_cell_m} onChange={event => onChange({...options, occupancy_cell_m: Number(event.target.value)})} /></label>
      <div className="settings-grid">{fields.map(([key, label, min, max]) => <label key={key}>{label}
        <input type="number" min={min} max={max} step="1" value={options[key] as number}
          onChange={event => onChange({...options, [key]: Number(event.target.value)})} />
      </label>)}</div>
      <label className="checkbox-label"><input type="checkbox" checked={options.surroundings_only} onChange={event => onChange({...options, surroundings_only:event.target.checked})} />Chercher uniquement à l’extérieur</label>
      <label className="checkbox-label"><input type="checkbox" checked={options.require_terrain} onChange={event => onChange({...options, require_terrain:event.target.checked})} />Exiger une pente suffisamment échantillonnée</label>
      <label className="checkbox-label"><input type="checkbox" checked={options.include_ground} onChange={event => onChange({...options,include_ground:event.target.checked})} />Proposer des zones au sol</label>
      <label className="checkbox-label"><input type="checkbox" checked={options.include_rooftops} onChange={event => onChange({...options,include_rooftops:event.target.checked})} />Proposer des zones en toiture · accès à vérifier</label>
      <label>Recul des bords du toit (m)<input type="number" min="2" max="20" value={options.roof_edge_setback_m} onChange={event => onChange({...options,roof_edge_setback_m:Number(event.target.value)})} /></label>
      <label>Pente maximale de toiture (°)<input type="number" min="1" max="20" value={options.max_roof_slope_deg} onChange={event => onChange({...options,max_roof_slope_deg:Number(event.target.value)})} /></label>
      <p>Un toit plat ne prouve ni accès, ni portance, ni protection contre les chutes.</p>
      <label>Pas de terrain souhaité (m, ajusté si nécessaire)<input type="number" min="5" max="100" value={options.terrain_spacing_m} onChange={event => onChange({...options, terrain_spacing_m:Number(event.target.value)})} /></label>
      <label>Recul des obstacles connus (m)<input type="number" min="1" max="100" value={options.obstacle_buffer_m} onChange={event => onChange({...options, obstacle_buffer_m:Number(event.target.value)})} /></label>
      <details><summary>Sources et pondérations</summary>
        {([['use_osm','OpenStreetMap'],['use_ign','IGN BD TOPO'],['use_imagery','IGN BD ORTHO'],['use_lidar','IGN LiDAR HD'],['use_panoramax','Panoramax']] as const).map(([key,label]) => <label className="checkbox-label" key={key}><input type="checkbox" checked={options[key]} onChange={event => onChange({...options,[key]:event.target.checked})} />{label}</label>)}
        {Object.entries(options.weights).map(([key,value]) => <label key={key}>{({accessibility:'Accès',area:'Surface',slope:'Pente',obstacles:'Obstacles',openness:'Dégagement',proximity:'Proximité'} as Record<string,string>)[key]} · poids (%)<input type="number" min="0" max="100" value={Math.round(value*100)} onChange={event => onChange({...options,weights:{...options.weights,[key]:Number(event.target.value)/100}})} /></label>)}
        <p>Les poids sont normalisés. Un critère inconnu n’apporte aucun point.</p>
      </details>
    </fieldset>
  </details>
}
