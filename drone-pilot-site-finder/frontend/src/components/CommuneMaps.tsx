import { useEffect, useState } from 'react'
import type { CommuneOccupancy } from '../types'

// Precomputed area-wide maps (scripts/build_commune_occupancy.py --insee CODE).
export const COMMUNE_MAPS = [{ insee: '09194', label: 'Mirepoix (Ariège)' }]

export async function loadCommuneMap(insee: string, signal?: AbortSignal): Promise<CommuneOccupancy> {
  const response = await fetch(`/occupancy/commune-${insee}.json`, { signal })
  if (!response.ok) throw new Error('Carte communale absente. Lancez scripts/build_commune_occupancy.py.')
  const data: CommuneOccupancy = await response.json()
  if (data.kind !== 'commune_takeoff_occupancy' || !Array.isArray(data.occupancy?.zones)) throw new Error('Fichier de carte communale incompatible.')
  return data
}

export default function CommuneMaps({ active, disabled, onLoad, onClear }: {
  active: CommuneOccupancy | null; disabled: boolean
  onLoad: (map: CommuneOccupancy) => void; onClear: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => setError(''), [active])
  async function load(insee: string) {
    setLoading(true); setError('')
    try { onLoad(await loadCommuneMap(insee)) } catch (failure) { setError(failure instanceof Error ? failure.message : 'Chargement impossible.') } finally { setLoading(false) }
  }
  return <div className="commune-maps">
    <div><strong>Carte d’occupation communale</strong><small>Où décoller sur tout le territoire, calculée hors ligne sur données ouvertes.</small></div>
    {COMMUNE_MAPS.map(item => active?.commune.insee === item.insee
      ? <button key={item.insee} className="chosen" disabled={disabled} onClick={onClear}>Masquer · {item.label}</button>
      : <button key={item.insee} disabled={disabled || loading} onClick={() => load(item.insee)}>{loading ? 'Chargement…' : `Afficher · ${item.label}`}</button>)}
    {active && <p>{active.commune.name} · {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(active.commune.area_m2 / 1e6)} km² · {active.tiles.total - active.tiles.failed.length}/{active.tiles.total} tuiles · calcul du {new Date(active.generated_at).toLocaleDateString('fr-FR')}</p>}
    {error && <p role="alert" className="commune-error">{error}</p>}
  </div>
}
