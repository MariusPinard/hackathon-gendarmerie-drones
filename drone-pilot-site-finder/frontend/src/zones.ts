import type { RelevanceLevel } from './types'

// Indicative suitability only: colors never encode operational safety or permission.
export const relevanceStyles: Record<RelevanceLevel, { label: string; color: string; background: string }> = {
  high: { label: 'Élevée', color: '#27775c', background: '#e7f2eb' },
  moderate: { label: 'Modérée', color: '#ad7d26', background: '#faf1db' },
  low: { label: 'Faible', color: '#b65e47', background: '#f9e9e1' },
}

export function formatZoneArea(areaM2: number): string {
  if (areaM2 < 0.000001) return '< 0,000001 m²'
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: areaM2 < 1 ? 6 : 0 }).format(areaM2)} m²`
}
