import { useState } from 'react'
import type { OccupancyMap, PolygonGeometry } from '../types'
import { takeoffStyles } from '../occupancy'
import { RANGE_M, autoPlace, coverage, nearestFreeSite, operationTargets, siteAt, type PilotPlacement, type PlacementMode, type Qualification } from '../pilots'

const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 })
const coordinate = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 5, maximumFractionDigits: 5 })

export default function PilotPanel({ occupancy, area, pilots, onChange, placing, onPlacing, qualification, onQualification, selected, onSelect, onFocus, disabled }: {
  occupancy: OccupancyMap | null; area: PolygonGeometry | null
  pilots: PilotPlacement[]; onChange: (pilots: PilotPlacement[]) => void
  placing: boolean; onPlacing: (value: boolean) => void
  qualification: Qualification; onQualification: (value: Qualification) => void
  selected: string | null; onSelect: (id: string | null) => void; onFocus: (pilot: PilotPlacement) => void
  disabled: boolean
}) {
  const [maxPilots, setMaxPilots] = useState(6)
  const [autoMode, setAutoMode] = useState<PlacementMode>('mixed')
  const [message, setMessage] = useState('')
  const covered = area ? coverage(operationTargets(area), pilots) : null
  const update = (id: string, change: Partial<PilotPlacement>) => onChange(pilots.map(p => p.id === id ? { ...p, ...change } : p))

  function runAuto() {
    if (!area || !occupancy) return
    const result = autoPlace(area, occupancy, pilots, autoMode, maxPilots)
    onChange([...pilots, ...result.placed])
    const tp1 = result.placed.filter(p => p.qualification === 'TP1').length
    setMessage(result.placed.length
      ? `${tp1} TP1 + ${result.placed.length - tp1} TP2 placé(s) sur des cellules libres, au moins 50 m d’écart${result.pruned ? `, ${result.pruned} redondant(s) retiré(s)` : ''} · zone couverte à ${percent.format(result.coverage)}.`
      : result.coverage >= 0.98 ? 'La zone est déjà couverte.' : 'Aucune cellule libre n’apporte de couverture dans la portée.')
  }

  function snap(pilot: PilotPlacement) {
    if (!occupancy) return
    const site = nearestFreeSite(occupancy, pilot.position)
    if (!site) { setMessage(`${pilot.name} : aucune cellule libre à moins de 600 m.`); return }
    update(pilot.id, { position: site.position })
    setMessage(`${pilot.name} déplacé de ${Math.round(site.distance)} m vers une cellule ${site.status === 'free' ? 'libre' : 'libre non confirmée'}.`)
  }

  function exportPilots() {
    const geojson = { type: 'FeatureCollection', features: pilots.map(p => {
      const site = siteAt(occupancy, p.position)
      return { type: 'Feature', geometry: { type: 'Point', coordinates: p.position }, properties: {
        name: p.name, qualification: p.qualification, range_m: RANGE_M[p.qualification], placement: p.auto ? 'automatique' : 'manuel',
        takeoff: site.verdict, status: site.zone?.status ?? null, cause: site.zone?.reason_label ?? null,
        review_scope: 'aide_a_la_decision_verification_terrain_obligatoire' } }
    }) }
    const url = URL.createObjectURL(new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'telepilotes.geojson'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <div className="pilot-panel">
    <div className="occupancy-heading"><h3>Télépilotes</h3><span>{pilots.length} placé(s){covered !== null && pilots.length ? ` · zone couverte ${percent.format(covered)}` : ''}</span></div>
    {!occupancy && <p className="occupancy-empty">Chargez la carte communale ou lancez une analyse pour placer des télépilotes sur la carte d’occupation.</p>}
    <div className="pilot-controls">
      <label>Qualification<select value={qualification} disabled={disabled} onChange={e => onQualification(e.target.value as Qualification)}><option value="TP1">TP1 · 1 km</option><option value="TP2">TP2 · 2 km</option></select></label>
      <button className={placing ? 'chosen' : ''} disabled={disabled || !occupancy} onClick={() => onPlacing(!placing)}>{placing ? 'Terminer le placement' : '+ Placer sur la carte'}</button>
    </div>
    {placing && <p className="pilot-hint">Cliquez sur la carte pour poser un {qualification}. Glissez un marqueur pour le déplacer.</p>}
    <div className="pilot-controls">
      <label>Mode auto<select value={autoMode} disabled={disabled} onChange={e => setAutoMode(e.target.value as PlacementMode)}><option value="mixed">TP1 puis TP2 si utile</option><option value="TP1">TP1 seulement</option><option value="TP2">TP2 seulement</option></select></label>
    </div>
    <div className="pilot-controls">
      <label>Maximum<input type="number" min="1" max="30" value={maxPilots} disabled={disabled} onChange={e => setMaxPilots(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} /></label>
      <button disabled={disabled || !occupancy || !area} title={area ? '' : 'Dessinez d’abord la zone d’opération'} onClick={runAuto}>Placement automatique</button>
    </div>
    {!area && occupancy && <p className="pilot-hint">Placement automatique : dessinez d’abord la zone d’opération (étape 01).</p>}
    {message && <p className="pilot-message" role="status">{message}</p>}
    <ul className="pilot-list">
      {pilots.map(pilot => {
        const site = siteAt(occupancy, pilot.position)
        const verdict = site.verdict === 'unknown' ? { label: 'Hors carte', color: '#6b7280' } : takeoffStyles[site.verdict]
        return <li key={pilot.id} className={selected === pilot.id ? 'selected' : ''}>
          <button className="pilot-name" onClick={() => { onSelect(pilot.id); onFocus(pilot) }}><i style={{ backgroundColor: verdict.color }}>{pilot.name}</i>
            <span><strong>{verdict.label}</strong><small>{site.zone ? site.zone.reason_label ?? site.zone.label : 'Position hors de la carte d’occupation'} · {coordinate.format(pilot.position[1])}, {coordinate.format(pilot.position[0])}</small></span></button>
          <div className="pilot-actions">
            <select aria-label={`Qualification de ${pilot.name}`} value={pilot.qualification} disabled={disabled} onChange={e => update(pilot.id, { qualification: e.target.value as Qualification })}><option value="TP1">TP1</option><option value="TP2">TP2</option></select>
            {site.verdict !== 'possible' && occupancy && <button disabled={disabled} onClick={() => snap(pilot)} title="Déplacer vers la cellule libre la plus proche">Recaler</button>}
            <button disabled={disabled} aria-label={`Retirer ${pilot.name}`} onClick={() => { onChange(pilots.filter(p => p.id !== pilot.id)); if (selected === pilot.id) onSelect(null) }}>✕</button>
          </div>
        </li>
      })}
    </ul>
    {pilots.length > 0 && <div className="pilot-controls"><button disabled={disabled} onClick={exportPilots}>Exporter (GeoJSON)</button><button disabled={disabled} onClick={() => { onChange([]); onSelect(null); setMessage('') }}>Tout retirer</button></div>}
    <p className="pilot-hint">Le statut vient de la carte d’occupation (cellules de {occupancy?.cell_size_m ?? 10} m). La position exacte, l’accès et l’autorisation restent à vérifier sur le terrain.</p>
  </div>
}
