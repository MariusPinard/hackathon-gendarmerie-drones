import type { AnalysisOptions, PolygonGeometry, SearchResponse } from './types'

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
export const apiDocsUrl = `${baseUrl}/api/docs`

export async function checkHealth(signal: AbortSignal): Promise<boolean> {
  const response = await fetch(`${baseUrl}/api/v1/health`, { signal })
  if (!response.ok) return false
  const body = await response.json()
  return body.status === 'ok' && body.mode === 'analysis'
}

export async function searchSites(area: PolygonGeometry, options: AnalysisOptions, signal: AbortSignal, maxCandidates = 5): Promise<SearchResponse> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/v1/sites/search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ operation_area: area, options, max_candidates: maxCandidates }),
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error('API inaccessible. Vérifiez que le backend est démarré sur le port 8000.')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    if (response.status === 422) {
      const detail = body?.error?.details?.[0]?.message || body?.error?.message || 'Requête non valide.'
      throw new Error(`Requête refusée : ${detail}`)
    }
    if (body?.error?.message) throw new Error(body.error.message)
    throw new Error(`L’API ne peut pas répondre (${response.status}). Vérifiez le backend et réessayez.`)
  }
  const body: SearchResponse = await response.json()
  if (body.type !== 'FeatureCollection' || body.metadata?.is_demo !== false ||
      body.metadata.contract_version !== '0.4' || body.metadata.candidate_kind !== 'pilot_zone' ||
      !Array.isArray(body.features) || body.features.some(feature =>
        !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type) ||
        feature.properties?.is_demo !== false || !Number.isFinite(feature.properties.area_m2) ||
        feature.properties.area_m2 <= 0 ||
        !['high', 'moderate', 'low'].includes(feature.properties.relevance_level) ||
        !['ground','rooftop'].includes(feature.properties.surface_type))) {
    throw new Error('Réponse incompatible : analyse réelle de surfaces, contrat 0.4 attendu. Redémarrez le backend.')
  }
  return body
}
