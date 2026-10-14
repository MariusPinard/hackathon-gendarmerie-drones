import type { OccupancyStatus, TakeoffVerdict } from './types'

// Screening colours only: « possible » never means authorised or verified on the ground.
export const occupancyStyles: Record<OccupancyStatus, { label: string; color: string; hint: string }> = {
  free: { label: 'Libre', color: '#2f9e5f', hint: 'Surface ouverte cartographiée, sans occupation connue, à portée.' },
  free_unconfirmed: { label: 'Libre non confirmé', color: '#a6cf86', hint: 'Aucune occupation connue, mais pas de surface ouverte cartographiée.' },
  light_vegetation: { label: 'Végétation basse', color: '#c9a227', hint: 'Haie, lande, verger ou vigne : décoller à côté, pas dessus.' },
  limited_range: { label: 'Portée partielle', color: '#e2c23b', hint: 'Atteint moins de la moitié de ce que couvrent les meilleurs points.' },
  no_access: { label: 'Accès éloigné', color: '#8195b8', hint: 'Trop loin d’une voie ou d’un chemin accessible.' },
  masked: { label: 'Vue masquée', color: '#e8862e', hint: 'Relief ou sursol masquent la majorité des cibles de la zone.' },
  out_of_range: { label: 'Hors portée', color: '#8d5cc4', hint: 'La zone d’opération est au-delà de la portée du télépilote.' },
  steep: { label: 'Pente excessive', color: '#4b4f5c', hint: 'Pente mesurée supérieure au maximum réglé.' },
  obstacle_buffer: { label: 'Marge obstacle', color: '#ec7a7a', hint: 'Trop proche d’un bâtiment, d’une ligne ou d’une voie ferrée.' },
  occupied: { label: 'Occupée', color: '#c0392b', hint: 'Bâti, chaussée, eau, végétation, sursol ou obstruction.' },
}

/** Display order: takeoff possible first, then conditional, then impossible. */
export const occupancyOrder: OccupancyStatus[] = ['free', 'free_unconfirmed', 'light_vegetation', 'limited_range', 'no_access', 'masked', 'out_of_range', 'steep', 'obstacle_buffer', 'occupied']

export const takeoffStyles: Record<TakeoffVerdict, { label: string; color: string }> = {
  possible: { label: 'Décollage possible', color: '#2f9e5f' },
  conditional: { label: 'Sous conditions', color: '#e2a93b' },
  impossible: { label: 'Impossible', color: '#c0392b' },
}

export const takeoffOf: Record<OccupancyStatus, TakeoffVerdict> = {
  free: 'possible', free_unconfirmed: 'conditional', light_vegetation: 'conditional', limited_range: 'conditional', no_access: 'conditional',
  masked: 'conditional', out_of_range: 'impossible', steep: 'impossible', obstacle_buffer: 'impossible', occupied: 'impossible',
}

export function formatHectares(areaM2: number): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: areaM2 < 10000 ? 2 : 1 }).format(areaM2 / 10000)} ha`
}
