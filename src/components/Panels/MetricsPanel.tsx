import type { CoverageMetrics } from '../../types/planning';

export function MetricsPanel({ metrics }: { metrics: CoverageMetrics }) {
  return <div className="metrics" aria-label="Métriques de couverture">
    <div><strong>{metrics.totalCoveragePercent.toFixed(1)} %</strong><span>Couverture totale</span></div>
    <div><strong>{metrics.priorityCoveragePercent === null ? '—' : `${metrics.priorityCoveragePercent.toFixed(1)} %`}</strong><span>Couverture prioritaire</span></div>
    <div><strong>{metrics.overlapPercent.toFixed(1)} %</strong><span>Surface en chevauchement</span></div>
    <div><strong>{metrics.usedDroneCount}</strong><span>Drones en couverture</span></div>
    <p className="muted">Estimation par {metrics.sampleCount} points · maille ≈ {Math.round(metrics.sampleSpacingMeters)} m</p>
  </div>;
}
