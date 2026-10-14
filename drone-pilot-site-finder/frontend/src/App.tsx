import { useEffect, useRef, useState } from 'react'
import { apiDocsUrl, checkHealth, searchSites } from './api'
import MapView, { type DrawingMode, type MapHandle } from './components/MapView'
import Icon from './components/Icon'
import AnalysisSettings, { defaultOptions } from './components/AnalysisSettings'
import ValidationCases from './components/ValidationCases'
import { approximateAreaKm2, demoArea } from './demoArea'
import type { PolygonGeometry, SearchResponse } from './types'
import { formatZoneArea, relevanceStyles } from './zones'

const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })
type Review = 'retained' | 'rejected'

export default function App() {
  const [area, setArea] = useState<PolygonGeometry | null>(null)
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawing, setDrawing] = useState<DrawingMode>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tileError, setTileError] = useState(false)
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [reviews, setReviews] = useState<Record<string, Review>>({})
  const [options, setOptions] = useState(defaultOptions)
  const [snapshotLabel,setSnapshotLabel] = useState<string|null>(null)
  const [maxCandidates,setMaxCandidates] = useState(5)
  const mapRef = useRef<MapHandle>(null)
  const requestRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    checkHealth(controller.signal).then((ok) => {
      if (!controller.signal.aborted) setApiStatus(ok ? 'online' : 'offline')
    }).catch(() => { if (!controller.signal.aborted) setApiStatus('offline') })
    return () => { controller.abort(); requestRef.current?.abort() }
  }, [])

  function clearResults() {
    requestRef.current?.abort()
    requestRef.current = null
    setLoading(false)
    setResult(null)
    setSelectedId(null)
    setReviews({})
    setError(null)
    setSnapshotLabel(null)
  }

  function changeArea(value: PolygonGeometry | null) {
    clearResults()
    setTileError(false)
    setArea(value)
  }

  function changeDrawing(value: DrawingMode) {
    if (value) clearResults()
    setDrawing(value)
  }

  async function search() {
    if (!area || drawing) return
    clearResults()
    const controller = new AbortController()
    requestRef.current = controller
    const timeout = window.setTimeout(() => controller.abort('timeout'), 180000)
    setLoading(true)
    try {
      const response = await searchSites(area, options, controller.signal, maxCandidates)
      if (requestRef.current !== controller) return
      setResult(response)
      setSelectedId(response.features[0]?.id || null)
      setApiStatus('online')
    } catch (failure) {
      if (requestRef.current !== controller) return
      if (controller.signal.aborted && controller.signal.reason !== 'timeout') return
      setError(controller.signal.reason === 'timeout'
        ? 'Délai de réponse dépassé. Vérifiez le backend puis réessayez.'
        : failure instanceof Error ? failure.message : 'La recherche a échoué. Réessayez.')
      if (!controller.signal.aborted) {
        try {
          const online = await checkHealth(controller.signal)
          if (requestRef.current === controller) setApiStatus(online ? 'online' : 'offline')
        } catch {
          if (requestRef.current === controller) setApiStatus('offline')
        }
      }
    } finally {
      window.clearTimeout(timeout)
      if (requestRef.current === controller) { setLoading(false); requestRef.current = null }
    }
  }

  function exportResults() {
    if (!result) return
    const exported = {...result, metadata: {...result.metadata, operator_review: reviews, review_scope: 'local_not_operational_approval'}}
    const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/geo+json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'pilot-zones-analysis.geojson'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const candidates = result?.features || []
  const vertices = area ? area.coordinates.reduce((sum, ring) => sum + ring.length - 1, 0) : 0
  const tilesEnabled = import.meta.env.VITE_TILES_ENABLED !== 'false'

  return <div className="app-shell">
    <header className="site-header">
      <a className="brand" href="/" aria-label="Pilot Site Finder, accueil">
        <img src="/favicon.svg" width="38" height="38" alt="" />
        <span>Pilot Site Finder<span className="brand-caption">CANDIDATE PILOT ZONES</span></span>
      </a>
      <div className="header-right">
        <span className="version-label">MODULE INDÉPENDANT <span>v0.4 · À VALIDER</span></span>
        <a className="docs-link" href={apiDocsUrl} target="_blank" rel="noreferrer"><Icon name="book" size={16} />Documentation API<Icon name="arrow" size={15} /></a>
      </div>
    </header>

    <main>
      <div className="page-intro">
        <div><div className="eyebrow"><span />PLANIFICATION · ANALYSE GÉOSPATIALE</div>
          <h1>Explorez votre zone d’opération.</h1>
          <p>Dessinez un périmètre et explorez des surfaces candidates de télépilotage.</p>
        </div>
        <span className="demo-badge real-data-badge"><span />DONNÉES OUVERTES · VALIDATION TERRAIN REQUISE</span>
      </div>

      <div className="workspace">
        <aside className="sidebar" aria-label="Définition de la zone et résultats">
          <div className="sidebar-content">
            <section className="area-section">
              <div className="section-title"><span className="step-number">01</span><h2>Définir la zone</h2><span className={`status-pill ${area ? 'ready' : ''}`}>{area ? 'Prête' : 'À dessiner'}</span></div>
              <p className="section-description">Délimitez votre zone sur la carte. Cliquez sur le premier sommet pour fermer le polygone.</p>
              <button className={`draw-button ${drawing ? 'drawing' : ''}`} disabled={drawing !== null && drawing !== 'draw'} onClick={() => drawing === 'draw' ? mapRef.current?.cancelDrawing() : mapRef.current?.startDrawing()}>
                <Icon name={drawing === 'draw' ? 'close' : 'polygon'} />{drawing === 'draw' ? 'Annuler le dessin' : drawing ? 'Modification sur la carte' : area ? 'Dessiner une nouvelle zone' : 'Dessiner une zone'}<span className="key-hint">{drawing === 'draw' ? 'Esc' : drawing ? '' : '+'}</span>
              </button>
              <button className="example-button" disabled={!!drawing || loading} onClick={() => changeArea(structuredClone(demoArea))}>ou charger la zone d’exemple<Icon name="arrow" size={14} /></button>
              <ValidationCases disabled={loading||!!drawing} onPrepare={item=>{changeArea(item.request.operation_area);setOptions({...defaultOptions,...item.request.options});setMaxCandidates(item.request.max_candidates)}} onSnapshot={(item,data)=>{changeArea(item.request.operation_area);setOptions({...defaultOptions,...data.metadata.options});setMaxCandidates(item.request.max_candidates);setResult(data);setSelectedId(data.features[0]?.id||null);setSnapshotLabel(item.label)}} />
              {area && <div className="area-summary">
                <div><span>SURFACE INDICATIVE</span><strong>{number.format(approximateAreaKm2(area))}<small> km²</small></strong></div>
                <div><span>SOMMETS</span><strong>{vertices}<small> points</small></strong></div>
                <button className="clear-area" title="Effacer la zone" aria-label="Effacer la zone" disabled={!!drawing} onClick={() => changeArea(null)}><Icon name="trash" size={16} /></button>
              </div>}
              <AnalysisSettings options={options} disabled={loading || !!drawing} onChange={value => {clearResults(); setOptions(value)}} />
              <button className="search-button" disabled={!area || !!drawing || loading} onClick={search}>
                {loading ? <span className="spinner" /> : <Icon name="pin" size={18} />}
                {loading ? 'Recherche en cours…' : 'Rechercher les zones candidates'}
                {!loading && <Icon name="arrow" size={17} />}
              </button>
              <p className="search-note">{drawing ? 'Terminez ou annulez la modification pour rechercher.' : loading ? 'Acquisition des sources et analyse en cours · jusqu’à 3 minutes.' : 'Emprise transmise aux services publics OSM / IGN / Panoramax.'}</p>
              {error && <div className="error-box" role="alert"><Icon name="info" /><span>{error}</span></div>}
            </section>

            <section className="results-section" aria-live="polite" aria-busy={loading}>
              <div className="section-title"><span className="step-number">02</span><h2>Zones candidates</h2><span className="result-count">{candidates.length.toString().padStart(2, '0')}</span>
                {result && <button className="icon-button" onClick={exportResults} aria-label="Exporter l’analyse en GeoJSON" title="Exporter l’analyse"><Icon name="download" size={16} /></button>}
              </div>
              {!result && <div className="empty-results">
                <div className="empty-icon"><Icon name="polygon" size={27} /><span className="orbit-dot" /></div>
                <h3>{loading ? 'Analyse des données réelles' : 'Votre exploration commence ici'}</h3>
                <p>{loading ? 'Vecteurs, images, relief et masquages géométriques. Les données indisponibles seront signalées.' : 'Définissez un périmètre, puis lancez la recherche.'}</p>
              </div>}
              {result && <>
                <p className="result-caption">{candidates.filter(c=>c.properties.surface_type==='ground').length} au sol · {candidates.filter(c=>c.properties.surface_type==='rooftop').length} en toiture · {number.format(result.metadata.elapsed_seconds)} s</p>
                {snapshotLabel&&<p className="snapshot-note">Capture réelle : {snapshotLabel} · {result.metadata.sources.find(s=>s.fetched_at)?.fetched_at?.slice(0,10)}. Affichage enregistré, à examiner.</p>}
                <p className="local-review-note">Profils sol/toiture distincts ; classement alterné. Version en attente de validation humaine.</p>
                {!candidates.length && <p className="no-results">Aucune zone avec ces contraintes et ces données. Consultez les sources et les limites avant d’ajuster les paramètres.</p>}
                {candidates.map((candidate, index) => {
                  const active = selectedId === candidate.id
                  const site = candidate.properties
                  const relevance = relevanceStyles[site.relevance_level]
                  const review = reviews[candidate.id]
                  return <article key={candidate.id} style={{ borderColor: active ? relevance.color : undefined }} className={`candidate-card ${active ? 'active' : ''} ${review === 'rejected' ? 'rejected' : ''}`}>
                    <button className="candidate-heading" aria-expanded={active} onClick={() => setSelectedId(active ? null : candidate.id)}>
                      <span className="candidate-number" style={{ backgroundColor: active ? relevance.color : relevance.background, color: active ? '#fff' : relevance.color, borderColor: relevance.color }}>{String(index + 1).padStart(2, '0')}</span>
                      <span className="candidate-name"><strong>{site.surface_type==='rooftop'?'Toiture':'Sol'} {String(index + 1).padStart(2, '0')}</strong><small>{formatZoneArea(site.area_m2)} · {review === 'retained' ? 'Retenue pour inspection' : review === 'rejected' ? 'Écartée' : 'À vérifier'}</small></span>
                      <span className="score">{number.format(site.score)}<small>/100</small></span>
                      <span className={`expand-icon ${active ? 'expanded' : ''}`}><Icon name="chevron" size={15} /></span>
                    </button>
                    {active && <div className="candidate-details">
                      <div className="zone-facts"><span><small>SUPERFICIE INDICATIVE</small><strong>{formatZoneArea(site.area_m2)}</strong></span><span style={{ color: relevance.color }}><small>PERTINENCE INDICATIVE</small><strong>{relevance.label}</strong></span></div>
                      <p className="surface-method">Surface géodésique WGS84 · {site.component_count === 1 ? '1 composante continue' : `${site.component_count} composantes distinctes`}</p>
                      <button className="focus-zone" onClick={() => mapRef.current?.focusZone(candidate.id)}><Icon name="crosshair" size={13} />Zoomer sur la zone</button>
                      {site.roof&&<div className="roof-evidence"><strong>TOITURE · ACCÈS ET SÉCURITÉ NON VALIDÉS</strong><p>Hauteur estimée : {number.format(site.roof.height_above_ground_m)} m · pente : {number.format(site.roof.slope_deg)}° · MNS local : {number.format(site.roof.sample_spacing_m)} m.</p><p>Accès {site.roof.access_status==='mapped'?'cartographié, à confirmer':'inconnu'}. Équipements {site.roof.equipment_status==='suspected'?'suspectés, à inspecter':'non résolus exhaustivement'}.</p><details><summary>Vérifications obligatoires sur la toiture</summary>{site.roof.checks_required.map(t=><p key={t}>{t}</p>)}</details></div>}
                      <div className="criteria">{site.criteria.map((criterion) => <div key={criterion.key} title={criterion.explanation}>
                        <div className="criterion-label"><span>{criterion.label}</span><strong>{criterion.score === null ? 'Non évalué' : number.format(criterion.score)}<small> · {Math.round(criterion.weight * 100)} %</small></strong></div>
                        <div className="score-track"><span style={{ width: `${criterion.score ?? 0}%` }} /></div>
                        <details className="criterion-evidence"><summary>{criterion.value === null ? 'Donnée manquante' : `${number.format(criterion.unit === 'fraction' ? criterion.value * 100 : criterion.value)} ${criterion.unit === 'fraction' ? '%' : criterion.unit || ''}`}</summary><p>{criterion.explanation}</p><span>Source : {criterion.source}</span></details>
                      </div>)}</div>
                      <p className="synthetic-note">Couverture des critères : {Math.round(site.evidence_coverage * 100)} %. Les valeurs inconnues n’apportent aucun point.</p>
                      <div className="uncertainty"><span />Incertitude {site.uncertainty === 'high' ? 'élevée' : 'modérée'}<small>Décollage non évalué</small></div>
                      {!!site.missing_data.length && <p className="missing-data">Non évalué : {site.missing_data.join(', ')}</p>}
                      <p className="candidate-explanation">{site.justifications[0]}</p>
                      <details className="analysis-detail"><summary>Masquages géométriques</summary>
                        <p>{site.visibility_estimate.status === 'not_assessed' ? 'Non évalués' : site.visibility_estimate.status === 'terrain_only' ? 'Terrain seul · obstacles non modélisés' : 'MNS LiDAR échantillonné'}</p>
                        <p>Rayons sans masque parmi les rayons évalués : {site.visibility_estimate.clear_fraction === null ? 'inconnu' : `${Math.round(site.visibility_estimate.clear_fraction * 100)} %`} · {site.visibility_estimate.evaluated_rays} évalués, {site.visibility_estimate.unknown_rays} inconnus.</p>
                        <p>Pas : {site.visibility_estimate.sampling_m ? `${number.format(site.visibility_estimate.sampling_m)} m` : 'inconnu'} · cible {site.visibility_estimate.target_height_agl_m} m AGL</p>
                        <p>{site.visibility_estimate.explanation}</p>
                      </details>
                      <details className="analysis-detail"><summary>Inspection au sol · Panoramax ({site.ground_photos.length})</summary>
                        {!site.ground_photos.length && <p>Aucune photo proche dans l’échantillon disponible. Cela ne prouve pas une absence de couverture.</p>}
                        {site.ground_photos.map(photo => <div className="ground-photo" key={photo.id}><a href={photo.url} target="_blank" rel="noreferrer">{photo.thumbnail_url && <img src={photo.thumbnail_url} loading="lazy" alt="Photographie Panoramax géolocalisée" />}Ouvrir la photo · {number.format(photo.distance_m)} m</a><small>{photo.attribution} · {photo.captured_at?.slice(0,10) || 'Date inconnue'} · <a href={photo.license_url} target="_blank" rel="noreferrer">Licence de la photo</a></small></div>)}
                      </details>
                      <details className="analysis-detail"><summary>Justifications et preuves</summary>{site.justifications.map(text => <p key={text}>{text}</p>)}<p>{site.source_ids.join(' · ')}</p></details>
                      <p className="operator-choice">La position exacte du télépilote est à choisir après vérification sur le terrain.</p>
                      <div className="review-actions">
                        <button className={review === 'retained' ? 'chosen' : ''} aria-pressed={review === 'retained'} onClick={() => setReviews((current) => ({ ...current, [candidate.id]: 'retained' }))}><Icon name="check" size={15} />Retenir pour inspection</button>
                        <button className={review === 'rejected' ? 'chosen rejected-choice' : ''} aria-pressed={review === 'rejected'} onClick={() => setReviews((current) => ({ ...current, [candidate.id]: 'rejected' }))}><Icon name="close" size={15} />Écarter</button>
                      </div>
                    </div>}
                  </article>
                })}
                <details className="source-reports"><summary>Sources, disponibilité et limites</summary>
                  <p>Pas d’échantillonnage régional du relief : {result.metadata.terrain_sampling_m ? `${number.format(result.metadata.terrain_sampling_m)} m` : 'indisponible'}</p>
                  {result.metadata.sources.map(source => <details key={source.id}><summary><span className={`source-dot ${source.status}`} />{source.name} · {({available:'disponible',partial:'partielle',unavailable:'indisponible',disabled:'désactivée'})[source.status]}</summary><p>{source.detail}</p><p>{source.feature_count} éléments · {source.license}</p><p>{source.attribution} · consultation {source.fetched_at?.slice(0,10) || 'inconnue'} · date des données {source.acquisition_date?.slice(0,10) || 'non fournie'}</p><a href={source.url} target="_blank" rel="noreferrer">Service source ↗</a></details>)}
                  {result.metadata.warnings.map(text => <p key={text} className="missing-data">{text}</p>)}
                  {result.metadata.limitations.map(text => <p key={text}>{text}</p>)}
                </details>
                <p className="local-review-note">Les choix sont conservés en mémoire et dans l’export, sans validation opérationnelle.</p>
              </>}
            </section>
          </div>
          <div className="sidebar-footer"><span className={`api-dot ${apiStatus}`} /><span>{apiStatus === 'online' ? 'API connectée' : apiStatus === 'offline' ? 'API indisponible · démarrez le backend' : 'Connexion à l’API…'}</span><span>GeoJSON</span></div>
        </aside>

        <section className="map-panel" aria-label="Espace cartographique">
          <MapView ref={mapRef} area={area} searchArea={result?.metadata.search_area || null} candidates={candidates} selectedId={selectedId}
            onAreaChange={changeArea} onSelect={setSelectedId} onDrawingChange={changeDrawing}
            onTileError={() => setTileError(true)} />
          {!drawing && <div className="map-label"><Icon name="layers" size={16} /><span>{tilesEnabled ? 'Fonds OSM / IGN' : 'Fond de carte désactivé'}</span><span className="map-label-divider" />WGS 84</div>}
          <button className="recenter-button" onClick={() => mapRef.current?.fitArea()} title="Recentrer sur la zone" aria-label="Recentrer sur la zone"><Icon name="crosshair" size={19} /></button>
          {!area && !drawing && <div className="map-hint"><span className="hint-icon"><Icon name="polygon" size={20} /></span><div><strong>Un périmètre pour commencer</strong><span>Dessinez votre zone ou chargez l’exemple.</span></div></div>}
          {drawing && <div className="drawing-hint" role="status"><span className="pulsing-dot" />{drawing === 'draw' ? 'Cliquez sur le premier sommet pour terminer' : 'Modification en cours · enregistrez pour appliquer'}</div>}
          {tileError && <div className="tile-warning" role="status">Erreur de chargement du fond de carte. Le dessin et la recherche restent utilisables.</div>}
          <div className="map-legend"><span><i className="legend-operation" />Opération</span><span>Sol : trait plein · Toit : pointillé</span>{Object.entries(relevanceStyles).map(([level, style]) => <span key={level}><i className="legend-surface" style={{ backgroundColor: style.background, borderColor: style.color }} />{style.label}</span>)}</div>
          <a className="map-report" href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Signaler une erreur de carte ↗</a>
        </section>
      </div>

      <div className="demo-notice"><Icon name="info" size={18} /><p><strong>Aide à la décision · vérification humaine requise.</strong> Données réelles, analyses indicatives. Aucune sécurité ni autorisation validée. Masquage géométrique, VLOS et liaison radio sont des questions distinctes.</p><span>PROTOTYPE</span></div>
      <footer className="page-footer"><span>Drone Pilot Site Finder <span> / </span> Candidate Pilot Zones · v0.4 · En attente de validation</span><span>Python · FastAPI · React · Leaflet</span></footer>
    </main>
  </div>
}
