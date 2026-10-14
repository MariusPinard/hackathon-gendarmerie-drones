import type { OccupancyMap, OccupancyStatus, TakeoffVerdict } from '../types'
import { formatHectares, occupancyOrder, occupancyStyles, takeoffOf, takeoffStyles } from '../occupancy'

const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 })
const ASSESSED: Record<string, string> = {
  range: 'Portée', terrain: 'Relief (pente)', surface_model: 'Sursol MNS', imagery: 'Orthophoto', access: 'Accès', masking: 'Masquage',
}

export default function OccupancyPanel({ occupancy, hidden, onToggle, opacity, onOpacity }: {
  occupancy: OccupancyMap | null | undefined
  hidden: ReadonlySet<OccupancyStatus>
  onToggle: (status: OccupancyStatus) => void
  opacity: number
  onOpacity: (value: number) => void
}) {
  if (!occupancy) return <div className="occupancy-panel"><h3>Carte d’occupation au décollage</h3>
    <p className="occupancy-empty">Non disponible pour ce résultat (désactivée ou capture antérieure). Relancez une analyse pour la calculer.</p></div>
  const statuses = occupancyOrder.filter(status => occupancy.area_by_status_m2[status])
  const verdicts = (['possible', 'conditional', 'impossible'] as TakeoffVerdict[]).map(verdict => ({
    verdict, share: statuses.filter(status => takeoffOf[status] === verdict).reduce((sum, status) => sum + (occupancy.share_by_status[status] ?? 0), 0),
  }))
  const reasons = (status: OccupancyStatus) => occupancy.zones.filter(zone => zone.status === status && zone.reason_label)
  return <div className="occupancy-panel">
    <div className="occupancy-heading"><h3>Carte d’occupation au décollage</h3><span>{occupancy.assessed.range === false ? 'Territoire' : `${new Intl.NumberFormat('fr-FR').format(occupancy.pilot_range_m)} m`} · cellules {occupancy.cell_size_m} m</span></div>
    <div className="takeoff-bar" role="img" aria-label={verdicts.map(v => `${takeoffStyles[v.verdict].label} ${percent.format(v.share)}`).join(', ')}>
      {verdicts.map(v => v.share > 0 && <span key={v.verdict} style={{ width: `${v.share * 100}%`, backgroundColor: takeoffStyles[v.verdict].color }} />)}
    </div>
    <div className="takeoff-totals">{verdicts.map(v => <span key={v.verdict}><i style={{ backgroundColor: takeoffStyles[v.verdict].color }} />{takeoffStyles[v.verdict].label}<strong>{percent.format(v.share)}</strong></span>)}</div>
    <ul className="occupancy-statuses">
      {statuses.map(status => {
        const style = occupancyStyles[status]
        const details = reasons(status)
        return <li key={status} className={hidden.has(status) ? 'muted' : ''}>
          <label title={style.hint}>
            <input type="checkbox" checked={!hidden.has(status)} onChange={() => onToggle(status)} />
            <i style={{ backgroundColor: style.color }} />
            <span><strong>{style.label}</strong><small>{style.hint}</small></span>
            <em>{formatHectares(occupancy.area_by_status_m2[status] ?? 0)}<small>{percent.format(occupancy.share_by_status[status] ?? 0)}</small></em>
          </label>
          {details.length > 0 && <div className="occupancy-reasons">{details.map(zone => <span key={zone.reason}>{zone.reason_label} · {formatHectares(zone.area_m2)}</span>)}</div>}
        </li>
      })}
    </ul>
    <label className="occupancy-opacity">Opacité de la carte<input type="range" min="0.1" max="0.8" step="0.05" value={opacity} onChange={event => onOpacity(Number(event.target.value))} /></label>
    <details className="analysis-detail"><summary>Méthode et données évaluées</summary>
      <p className="assessed-list">{Object.entries(occupancy.assessed).map(([key, value]) => <span key={key} className={value ? 'yes' : 'no'}>{value ? '✓' : '✕'} {ASSESSED[key] ?? key}</span>)}</p>
      {occupancy.notes.map(note => <p key={note}>{note}</p>)}
      <p>Cliquez une couleur sur la carte pour voir la cause. Un statut « possible » reste à vérifier sur le terrain : ni autorisation, ni sécurité garanties.</p>
    </details>
  </div>
}
