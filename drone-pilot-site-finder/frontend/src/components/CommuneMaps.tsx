import { useEffect, useState } from 'react'
import type { CommuneOccupancy } from '../types'

// Precomputed area-wide maps (scripts/build_commune_occupancy.py --insee CODE).
export const COMMUNE_MAPS = [{ insee: '09194', label: 'Mirepoix (Ariège)' }]

/** Communes listed in public/occupancy/index.json, Mirepoix first. */
export async function loadCommuneList(): Promise<{ insee: string; label: string }[]> {
  try {
    const response = await fetch('/occupancy/index.json')
    if (!response.ok) return COMMUNE_MAPS
    const list: { insee: string; name: string }[] = await response.json()
    const items = list.map(item => ({ insee: item.insee, label: item.name }))
    return [...items.filter(item => item.insee === '09194'), ...items.filter(item => item.insee !== '09194')]
  } catch { return COMMUNE_MAPS }
}

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
  const [communes, setCommunes] = useState(COMMUNE_MAPS)
  useEffect(() => { void loadCommuneList().then(setCommunes) }, [])
  useEffect(() => setError(''), [active])
  async function load(insee: string) {
    setLoading(true); setError('')
    try { onLoad(await loadCommuneMap(insee)) } catch (failure) { setError(failure instanceof Error ? failure.message : 'Chargement impossible.') } finally { setLoading(false) }
  }
  return <div className="commune-maps">
    <div><strong>Carte d’occupation communale</strong><small>Où décoller sur tout le territoire, calculée hors ligne sur données ouvertes.</small></div>
    {active && <button className="chosen" disabled={disabled} onClick={onClear}>Masquer · {active.commune.name}</button>}
    <select aria-label="Commune précalculée" disabled={disabled || loading} value="" onChange={e => { if (e.target.value) void load(e.target.value) }}>
      <option value="">{loading ? 'Chargement…' : `Afficher une commune (${communes.length})`}</option>
      {communes.map(item => <option key={item.insee} value={item.insee}>{item.label}</option>)}
    </select>
    {active && <p>{active.commune.name} · {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(active.commune.area_m2 / 1e6)} km² · {active.tiles.total - active.tiles.failed.length}/{active.tiles.total} tuiles · calcul du {new Date(active.generated_at).toLocaleDateString('fr-FR')}</p>}
    {error && <p role="alert" className="commune-error">{error}</p>}
  </div>
}
