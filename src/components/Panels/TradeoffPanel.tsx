import type { PlanningResult } from '../../types/planning';

export const GAIN_PRESETS = [
  { value: 5, label: 'Économe', hint: 'un drone de plus seulement s’il apporte ≥ 5 points' },
  { value: 3, label: 'Équilibré', hint: 'un drone de plus s’il apporte ≥ 3 points' },
  { value: 1, label: 'Couverture maximale', hint: 'un drone de plus dès 1 point gagné' },
];

/** Coverage obtained for each number of drones, and the trade-off retained by the optimiser. */
export function TradeoffPanel({ tradeoff, minimumGain, onMinimumGain, disabled }: {
  tradeoff: PlanningResult['tradeoff']; minimumGain: number; onMinimumGain: (value: number) => void; disabled: boolean;
}) {
  if (!tradeoff?.length) return null;
  return <div className="tradeoff-panel">
    <div className="tradeoff-heading"><strong>Couverture selon le nombre de drones</strong>
      <select aria-label="Exigence de couverture" value={minimumGain} disabled={disabled} onChange={event => onMinimumGain(Number(event.target.value))}>
        {GAIN_PRESETS.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
      </select>
    </div>
    <ol className="tradeoff-bars">{tradeoff.map(point => <li key={point.drones} className={point.chosen ? 'chosen' : ''}>
      <span>{point.drones}</span>
      <i style={{ width: `${Math.max(2, point.coveragePercent)}%` }} aria-hidden="true" />
      <b>{point.coveragePercent.toLocaleString('fr-FR')} %</b>
    </li>)}</ol>
    <small className="muted">Meilleure disposition calculée pour chaque nombre de drones. Retenu : {GAIN_PRESETS.find(p => p.value === minimumGain)?.hint ?? `≥ ${minimumGain} points par drone`} (priorités ×4).</small>
  </div>;
}
