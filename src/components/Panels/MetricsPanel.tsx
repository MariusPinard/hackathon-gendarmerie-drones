import type { CoverageMetrics } from '../../types/planning';

export function MetricsPanel({ metrics }: { metrics: CoverageMetrics }) {
  const percent = (value: number) => `${value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
  return <div className="metrics" aria-label="Métriques de couverture">
    <div><strong>{percent(metrics.totalCoveragePercent)}</strong><span>Couverture totale</span></div>
    <div><strong>{metrics.priorityCoveragePercent === null ? '—' : percent(metrics.priorityCoveragePercent)}</strong><span>Couverture prioritaire</span></div>
    <div><strong>{percent(metrics.overlapPercent)}</strong><span>Surface en chevauchement</span></div>
    <div><strong>{metrics.usedDroneCount}</strong><span>Drones en couverture</span></div>
    <p className="muted">Estimation par {metrics.sampleCount} points · maille ≈ {Math.round(metrics.sampleSpacingMeters)} m</p>
  </div>;
}
