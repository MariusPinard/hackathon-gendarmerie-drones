import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import L from 'leaflet'
import 'leaflet-draw'
import type { Candidate, PolygonGeometry } from '../types'
import { formatZoneArea, relevanceStyles } from '../zones'

export interface MapHandle {
  startDrawing: () => void
  cancelDrawing: () => void
  fitArea: () => void
  focusZone: (id: string) => void
}

export type DrawingMode = 'draw' | 'edit' | 'delete' | null

interface Props {
  area: PolygonGeometry | null
  searchArea: import('../types').SurfaceGeometry | null
  candidates: Candidate[]
  selectedId: string | null
  onAreaChange: (area: PolygonGeometry | null) => void
  onSelect: (id: string) => void
  onDrawingChange: (mode: DrawingMode) => void
  onTileError: () => void
}

const polygonStyle = { color: '#506556', weight: 2, dashArray: '6 5', fillOpacity: 0.025 }

export default forwardRef<MapHandle, Props>(function MapView(props, ref) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const areaLayers = useRef<L.FeatureGroup | null>(null)
  const candidateLayers = useRef<L.LayerGroup | null>(null)
  const searchLayers = useRef<L.LayerGroup | null>(null)
  const candidateShapes = useRef(new Map<string, L.GeoJSON>())
  const drawRef = useRef<L.Draw.Polygon | null>(null)
  const callbacks = useRef(props)
  callbacks.current = props

  useImperativeHandle(ref, () => ({
    startDrawing: () => drawRef.current?.enable(),
    cancelDrawing: () => drawRef.current?.disable(),
    focusZone: (id) => {
      const surface = candidateShapes.current.get(id)
      if (surface) mapRef.current?.fitBounds(surface.getBounds(), { padding: [80, 80], maxZoom: 19 })
    },
    fitArea: () => {
      const bounds = areaLayers.current?.getBounds()
      if (bounds?.isValid()) mapRef.current?.fitBounds(bounds, { padding: [65, 65], maxZoom: 15 })
      else mapRef.current?.setView([48.412, 2.681], 13)
    },
  }), [])

  useEffect(() => {
    if (!container.current) return
    const map = L.map(container.current, { zoomControl: false }).setView([48.412, 2.681], 13)
    mapRef.current = map
    L.control.zoom({ position: 'topright' }).addTo(map)
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map)
    if (import.meta.env.VITE_TILES_ENABLED !== 'false') {
      const base = L.tileLayer(import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: import.meta.env.VITE_TILE_ATTRIBUTION ||
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).on('tileerror', () => callbacks.current.onTileError()).addTo(map)
      const ortho = L.tileLayer.wms('https://data.geopf.fr/wms-r', {
        layers: 'ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg', version: '1.3.0',
        attribution: '© IGN · BD ORTHO · Licence Ouverte 2.0', maxZoom: 19,
      }).on('tileerror', () => callbacks.current.onTileError())
      L.control.layers({'OpenStreetMap': base, 'BD ORTHO · IGN': ortho}, {}, {position: 'bottomright'}).addTo(map)
    }
    const areas = L.featureGroup().addTo(map)
    areaLayers.current = areas
    candidateLayers.current = L.layerGroup().addTo(map)
    searchLayers.current = L.layerGroup().addTo(map)
    L.drawLocal.draw.toolbar.buttons.polygon = 'Dessiner un polygone'
    L.drawLocal.draw.toolbar.actions.title = 'Annuler le dessin'
    L.drawLocal.draw.toolbar.actions.text = 'Annuler'
    L.drawLocal.draw.toolbar.finish.title = 'Terminer le polygone'
    L.drawLocal.draw.toolbar.finish.text = 'Terminer'
    L.drawLocal.draw.toolbar.undo.title = 'Supprimer le dernier sommet'
    L.drawLocal.draw.toolbar.undo.text = 'Dernier sommet'
    L.drawLocal.draw.handlers.polygon.tooltip.start = 'Cliquez pour placer le premier sommet.'
    L.drawLocal.draw.handlers.polygon.tooltip.cont = 'Cliquez pour ajouter un sommet.'
    L.drawLocal.draw.handlers.polygon.tooltip.end = 'Cliquez sur le premier sommet pour terminer.'
    L.drawLocal.edit.toolbar.buttons.edit = 'Modifier la zone'
    L.drawLocal.edit.toolbar.buttons.editDisabled = 'Dessinez une zone pour la modifier'
    L.drawLocal.edit.toolbar.buttons.remove = 'Supprimer la zone'
    L.drawLocal.edit.toolbar.buttons.removeDisabled = 'Aucune zone à supprimer'
    L.drawLocal.edit.toolbar.actions.save.text = 'Enregistrer'
    L.drawLocal.edit.toolbar.actions.cancel.text = 'Annuler'
    L.drawLocal.edit.toolbar.actions.clearAll.text = 'Tout supprimer'
    L.drawLocal.edit.handlers.edit.tooltip.text = 'Déplacez les sommets pour modifier la zone.'
    L.drawLocal.edit.handlers.edit.tooltip.subtext = 'Enregistrez pour appliquer les changements.'
    L.drawLocal.edit.handlers.remove.tooltip.text = 'Cliquez sur la zone à supprimer.'
    const drawOptions = {
      // Leaflet.draw 1.0.4's readableArea helper uses an undeclared variable in strict
      // bundles. Keep its live measurement off; the sidebar has our own area estimate.
      allowIntersection: false, showArea: false, shapeOptions: polygonStyle,
      drawError: { color: '#c34c39', message: 'Les côtés ne doivent pas se croiser.' },
    }
    const control = new L.Control.Draw({
      position: 'topleft',
      draw: { polygon: false, polyline: false, rectangle: false, circle: false,
        marker: false, circlemarker: false },
      edit: { featureGroup: areas },
    })
    map.addControl(control)
    const draw = new L.Draw.Polygon(map, drawOptions)
    drawRef.current = draw
    map.on(L.Draw.Event.CREATED, (event) => {
      const geometry = ((event as L.DrawEvents.Created).layer as L.Polygon).toGeoJSON().geometry
      if (geometry.type === 'Polygon') callbacks.current.onAreaChange(geometry)
    })
    map.on(L.Draw.Event.EDITED, () => {
      const polygon = areas.getLayers()[0] as L.Polygon | undefined
      const geometry = polygon?.toGeoJSON().geometry
      if (geometry?.type === 'Polygon') callbacks.current.onAreaChange(geometry)
    })
    map.on(L.Draw.Event.DELETED, () => callbacks.current.onAreaChange(null))
    map.on(L.Draw.Event.DRAWSTART, () => callbacks.current.onDrawingChange('draw'))
    map.on(L.Draw.Event.DRAWSTOP, () => callbacks.current.onDrawingChange(null))
    // Invalidate the previous result as soon as an edit/delete session begins.
    map.on(L.Draw.Event.EDITSTART, () => callbacks.current.onDrawingChange('edit'))
    map.on(L.Draw.Event.DELETESTART, () => callbacks.current.onDrawingChange('delete'))
    map.on(L.Draw.Event.EDITSTOP, () => callbacks.current.onDrawingChange(null))
    map.on(L.Draw.Event.DELETESTOP, () => callbacks.current.onDrawingChange(null))
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container.current)
    return () => {
      observer.disconnect()
      draw.disable()
      map.remove()
      mapRef.current = null
      areaLayers.current = null
      candidateLayers.current = null
      searchLayers.current = null
      candidateShapes.current.clear()
    }
  }, [])

  useEffect(() => {
    const layers = areaLayers.current
    if (!layers) return
    layers.clearLayers()
    if (props.area) {
      L.geoJSON(props.area, { style: polygonStyle }).eachLayer((layer) => layers.addLayer(layer))
      const bounds = layers.getBounds()
      if (bounds.isValid()) mapRef.current?.fitBounds(bounds, { padding: [65, 65], maxZoom: 15 })
    }
  }, [props.area])

  useEffect(() => {
    searchLayers.current?.clearLayers()
    if (props.searchArea && searchLayers.current) {
      const surface = L.geoJSON(props.searchArea, { interactive: false,
        style: { color: '#7e8db0', weight: 1, dashArray: '4 6', fillOpacity: 0.015 },
      }).addTo(searchLayers.current)
      mapRef.current?.fitBounds(surface.getBounds(), { padding: [40, 60], maxZoom: 16 })
    }
  }, [props.searchArea])

  useEffect(() => {
    const layers = candidateLayers.current
    if (!layers) return
    layers.clearLayers()
    candidateShapes.current.clear()
    props.candidates.forEach((candidate, index) => {
      const site = candidate.properties
      const relevance = relevanceStyles[site.relevance_level]
      const surface = L.geoJSON(candidate.geometry, { style: {
        color: relevance.color, fillColor: relevance.color,
        fillOpacity: 0.25, weight: 2, className: 'candidate-zone',
        dashArray: site.surface_type === 'rooftop' ? '6 4' : undefined,
      } })
      const label = document.createElement('span')
      label.textContent = `${String(index + 1).padStart(2, '0')} · ${site.surface_type === 'rooftop' ? 'Toit' : 'Sol'} · ${site.score}/100`
      surface.bindTooltip(label, { permanent: true, direction: 'center', className: 'zone-label' })
      surface.eachLayer((layer) => {
        layer.on('click', () => callbacks.current.onSelect(candidate.id))
        layer.on('add', () => {
          const element = (layer as L.Path).getElement()
          if (!element) return
          element.setAttribute('role', 'button')
          element.setAttribute('tabindex', '0')
          element.setAttribute('aria-label', `${site.name}, ${formatZoneArea(site.area_m2)}, score indicatif ${site.score}/100`)
          element.setAttribute('aria-pressed', 'false')
          element.addEventListener('keydown', (event) => {
            const keyEvent = event as KeyboardEvent
            if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
              keyEvent.preventDefault()
              callbacks.current.onSelect(candidate.id)
            }
          })
        })
      })
      surface.addTo(layers)
      candidateShapes.current.set(candidate.id, surface)
    })
  }, [props.candidates])

  useEffect(() => {
    // Keep SVG elements stable so mouse/keyboard selection preserves focus.
    props.candidates.forEach(candidate => {
      const selected = candidate.id === props.selectedId
      const surface = candidateShapes.current.get(candidate.id)
      surface?.setStyle({ fillOpacity: selected ? 0.42 : 0.25, weight: selected ? 4 : 2 })
      surface?.eachLayer(layer => (layer as L.Path).getElement()?.setAttribute('aria-pressed', String(selected)))
      if (selected) {
        const focused = document.activeElement
        surface?.bringToFront()
        // Reordering an SVG path can drop focus even though its element is reused.
        if (focused instanceof SVGElement && focused.isConnected) focused.focus()
      }
    })
  }, [props.candidates, props.selectedId])

  return <div ref={container} className="map-canvas" aria-label="Carte interactive de la zone d’opération" />
})
