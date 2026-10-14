import { useEffect, useMemo, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Coordinates, OperationZone, PriorityZone } from '../../types/geo';
import type { DroneInstance, Pilot } from '../../types/drone';
import { coveragePolygon, coveragePolygons, hasCoverage, outsideCoverageArc, uncoveredDisplayPoints, overlapPolygons } from '../../engines/geometry/index.ts';
import { MAP_SOURCES } from './mapSources';
import { useOccupancyOverlay } from './occupancyOverlay';
import { OCCUPANCY_STYLES } from '../../services/occupancy';

interface MapProps {
  center: Coordinates;
  recenterKey?: number;
  operationZone: OperationZone | null;
  priorityZones: PriorityZone[];
  drones?: DroneInstance[];
  pilots?: Pilot[];
  uncoveredPoints?: Coordinates[];
  drawing?: boolean;
  vertices?: Coordinates[];
  onVertex?: (point: Coordinates) => void;
  onFinish?: () => void;
  selected?: string | null;
  conflictDroneIds?: string[];
  editable?: boolean;
  placingDroneId?: string | null;
  onSelect?: (id: string) => void;
  onMoveDrone?: (id: string, point: Coordinates) => void;
  onMovePilot?: (id: string, point: Coordinates) => void;
}
const latLng = (p: Coordinates): L.LatLngTuple => [p[1], p[0]];
const rings = (coordinates: Coordinates[][]): L.LatLngTuple[][] => coordinates.map(r => r.map(latLng));

export function MissionMap(props: MapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const [tileError, setTileError] = useState(false);
  const [layer, setLayer] = useState<'plan' | 'satellite' | 'occupation'>('plan');
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const occupancy = useOccupancyOverlay(mapInstance, layer === 'occupation', !props.drawing && !props.placingDroneId);
  const geometryKey = JSON.stringify(props.operationZone?.geometry ?? null);
  const displayDots = useMemo(() => props.operationZone && props.uncoveredPoints && (!!props.drones?.length || !!props.uncoveredPoints.length)
    ? uncoveredDisplayPoints(props.operationZone.geometry, props.drones ?? []) : [], [props.operationZone, props.drones, !!props.uncoveredPoints, !!props.uncoveredPoints?.length]);
  const sharedAreas = useMemo(() => props.operationZone ? overlapPolygons(props.operationZone.geometry, props.drones ?? []) : [], [props.operationZone, props.drones]);
  const [longitude, latitude] = props.center;
  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, { doubleClickZoom: false, zoomControl: false }).setView(latLng(callbacks.current.center), 13);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    mapRef.current = map;
    setMapInstance(map);
    layersRef.current = L.layerGroup().addTo(map);
    map.on('click', (event: L.LeafletMouseEvent) => {
      const current = callbacks.current;
      if (current.drawing) current.onVertex?.([event.latlng.lng, event.latlng.lat]);
      else if (current.placingDroneId && current.editable) current.onMoveDrone?.(current.placingDroneId, [event.latlng.lng, event.latlng.lat]);
    });
    map.on('dblclick', () => { if (callbacks.current.drawing) callbacks.current.onFinish?.(); });
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(container.current);
    return () => { resize.disconnect(); map.remove(); mapRef.current = null; layersRef.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    const source = MAP_SOURCES[layer === 'occupation' ? 'plan' : layer];
    if (!map || !source) return;
    setTileError(false);
    // Keep a readable plan under orthophotos during loading and when an IGN tile fails.
    const fallback = layer === 'satellite' ? L.tileLayer(MAP_SOURCES.plan.urlTemplate, {
      maxZoom: source.maxZoom, maxNativeZoom: MAP_SOURCES.plan.maxZoom, attribution: MAP_SOURCES.plan.attribution, zIndex: 1,
    }).addTo(map) : null;
    const tiles = L.tileLayer(source.urlTemplate, { maxZoom: source.maxZoom, maxNativeZoom: source.maxZoom,
      attribution: source.attribution, zIndex: 2, keepBuffer: 3,
      errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
    }).addTo(map);
    tiles.on('tileerror', () => setTileError(true));
    return () => { tiles.off('tileerror'); map.removeLayer(tiles); if (fallback) map.removeLayer(fallback); };
  }, [layer]);
  useEffect(() => { mapRef.current?.setView([latitude, longitude], 13); }, [latitude, longitude, props.recenterKey]);
  useEffect(() => {
    if (props.operationZone) mapRef.current?.fitBounds(L.latLngBounds(props.operationZone.geometry.coordinates[0]!.map(latLng)), { padding: [100, 70], maxZoom: 15 });
  }, [geometryKey]);
  useEffect(() => {
    mapRef.current?.attributionControl.getContainer()?.querySelectorAll('a').forEach(link => {
      if (props.drawing) link.setAttribute('tabindex', '-1'); else link.removeAttribute('tabindex');
    });
  }, [props.drawing, layer]);
  useEffect(() => {
    const layers = layersRef.current;
    const map = mapRef.current;
    if (!layers || !map) return;
    layers.clearLayers();
    if (props.operationZone) L.polygon(rings(props.operationZone.geometry.coordinates), { stroke: false, fillColor: 'var(--map-operation)', fillOpacity: 0.07, interactive: false }).addTo(layers);
    props.priorityZones.forEach(z => L.polygon(rings(z.geometry.coordinates), { color: 'var(--map-priority)', weight: 2, fillColor: 'var(--map-priority-fill)', fillOpacity: 0.28, interactive: false }).addTo(layers));
    if (layer !== 'occupation') displayDots.forEach(point => L.circleMarker(latLng(point), {
      className: 'uncovered-point', radius: 2, color: 'var(--map-lost)', fillColor: 'var(--map-lost)', weight: 0, fillOpacity: .8, interactive: false,
    }).addTo(layers));
    const vertices = props.vertices ?? [];
    if (vertices.length) {
      L.polyline(vertices.map(latLng), { color: 'var(--map-selected)', weight: 3, interactive: false }).addTo(layers);
      if (vertices.length >= 3) L.polyline([latLng(vertices.at(-1)!), latLng(vertices[0]!)], { color: 'var(--map-selected)', dashArray: '5 7', weight: 2, interactive: false }).addTo(layers);
      vertices.slice(1).forEach(p => L.circleMarker(latLng(p), { radius: 5, color: 'var(--map-operation)', fillColor: 'var(--surface)', fillOpacity: 1, interactive: false }).addTo(layers));
      const first = L.marker(latLng(vertices[0]!), { title: 'Fermer le polygone', bubblingMouseEvents: false,
        icon: L.divIcon({ className: `draw-first-node ${vertices.length >= 3 ? 'closable' : ''}`, html: '<span>1</span>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(layers);
      first.bindTooltip('Cliquer ici pour fermer la zone');
      first.on('click', (event: L.LeafletMouseEvent) => { if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent); callbacks.current.onFinish?.(); });
    }
    const selectable = !props.drawing && !props.placingDroneId;
    const interactive = (props.editable ?? false) && selectable;
    props.pilots?.forEach((pilot, index) => {
      const marker = L.marker(latLng(pilot.pilotPosition), { draggable: interactive, interactive: selectable, keyboard: selectable,
        icon: L.divIcon({ className: 'pilot-marker', html: `<span>T${index + 1}</span>`, iconSize: [28, 28], iconAnchor: [40, -6] }) }).addTo(layers);
      const label = document.createElement('span'); label.textContent = pilot.name; marker.bindTooltip(label);
      marker.on('click', () => { if (!callbacks.current.drawing && !callbacks.current.placingDroneId) callbacks.current.onSelect?.(`pilot:${pilot.id}`); });
      marker.on('dragend', () => { const p = marker.getLatLng(); callbacks.current.onMovePilot?.(pilot.id, [p.lng, p.lat]); });
    });
    props.drones?.forEach((drone, index) => {
      const conflict = hasCoverage(drone) && props.conflictDroneIds?.includes(drone.id);
      const selected = props.selected === `drone:${drone.id}`;
      const color = conflict ? 'var(--map-conflict)' : selected ? 'var(--map-selected)' : 'var(--map-coverage)';
      if (hasCoverage(drone) || (selected && drone.status === 'reserve')) {
        if (props.operationZone) {
          outsideCoverageArc(drone.coverage, props.operationZone.geometry).forEach(arc => {
            L.polyline(arc.map(latLng), { className: 'exterior-arc', color: 'var(--map-contrast-dark)', weight: 3.5, opacity: .95, dashArray: '6 8', interactive: false }).addTo(layers);
            L.polyline(arc.map(latLng), { className: 'exterior-arc', color: 'var(--map-exterior)', weight: 2, opacity: 1, dashArray: '6 8', interactive: false }).addTo(layers);
          });
        }
      }
      if (hasCoverage(drone) || (selected && drone.status === 'reserve')) {
        const coverage = props.operationZone && drone.coverage.clipPolygon !== props.operationZone.geometry ? { ...drone.coverage, clipPolygon: props.operationZone.geometry } : drone.coverage;
        coveragePolygons(coverage).forEach(polygon => {
          const shape = rings(polygon.coordinates);
          L.polygon(shape, { color: 'var(--map-contrast-dark)', weight: selected ? 5.5 : 4.5, opacity: .85, fill: false, interactive: false }).addTo(layers);
          L.polygon(shape, { color: 'var(--map-contrast-light)', weight: selected ? 4 : 3, opacity: .95, fill: false, interactive: false }).addTo(layers);
          L.polygon(shape, { color, weight: selected ? 2.5 : 1.5, fillOpacity: selected ? .24 : .13, interactive: false }).addTo(layers);
        });
        if (selected) {
          const arc = coveragePolygon({ ...drone.coverage, workingAngleDegrees: 1 }).coordinates[0]!;
          const tip = arc[2]!;
          L.polyline([latLng(drone.dronePosition), latLng(tip)], { color, weight: 2.5, dashArray: '6 4', interactive: false }).addTo(layers);
          L.marker(latLng(tip), { interactive: false, keyboard: false, icon: L.divIcon({ className: 'heading-arrow', html: `<span style="transform:rotate(${drone.coverage.headingDegrees}deg)">↑</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(layers);
        }
      }
      const marker = L.marker(latLng(drone.dronePosition), { draggable: interactive && (hasCoverage(drone) || drone.status === 'reserve'), interactive: selectable, keyboard: selectable,
        icon: L.divIcon({ className: `drone-marker ${selected ? 'selected' : ''} ${conflict ? 'conflict' : ''} ${drone.status}`,
          html: `<span>D${index + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(layers);
      marker.bindTooltip(`D${index + 1} · ${drone.altitudeMetersAgl.toFixed(0)} m`);
      marker.on('click', () => { if (!callbacks.current.drawing && !callbacks.current.placingDroneId) callbacks.current.onSelect?.(`drone:${drone.id}`); });
      marker.on('dragend', () => { const p = marker.getLatLng(); callbacks.current.onMoveDrone?.(drone.id, [p.lng, p.lat]); });
    });
    // One nonzero path paints pair/triple overlaps uniformly without even-odd cancellation.
    if (layer !== 'occupation' && sharedAreas.length) L.polygon(sharedAreas.map(polygon => rings(polygon.coordinates)), {
      className: 'shared-coverage', stroke: false, fillColor: '#ffd43b', fillOpacity: .48, fillRule: 'nonzero', interactive: false,
    }).addTo(layers);
    // Keep the operation outline identifiable where a clipped drone area shares its boundary.
    if (props.operationZone) {
      L.polygon(rings(props.operationZone.geometry.coordinates), { color: 'var(--map-contrast-light)', weight: 7, fill: false, opacity: 0.95, interactive: false }).addTo(layers);
      L.polygon(rings(props.operationZone.geometry.coordinates), { color: 'var(--map-operation)', weight: 3.5, fill: false, interactive: false }).addTo(layers);
    }

  }, [props, layer, displayDots, sharedAreas]);
  return <div className={`map-wrap ${layer === 'satellite' ? 'satellite-map' : ''} ${props.drawing ? 'draw-lock' : ''}`}>
    <button className="map-center square-tool" disabled={props.drawing || !!props.placingDroneId || !props.operationZone} onClick={() => {
      if (props.operationZone) mapRef.current?.fitBounds(L.latLngBounds(props.operationZone.geometry.coordinates[0]!.map(latLng)), { padding: [100, 70], maxZoom: 15 });
    }} aria-label="Centrer la carte sur la zone d’opération" title="Centrer sur la zone d’opération"><span className="tool-icon" aria-hidden="true">⌖</span><span>Centrer la carte</span></button>
    <div className="map-toolbar" aria-label="Fond cartographique"><button aria-pressed={layer === 'plan'} disabled={props.drawing} onClick={() => setLayer('plan')}>Plan</button><button aria-pressed={layer === 'satellite'} disabled={props.drawing} onClick={() => setLayer('satellite')}>Satellite</button><button aria-pressed={layer === 'occupation'} disabled={props.drawing} onClick={() => setLayer('occupation')} title="Occupation du terrain et possibilités de décollage">Occupation</button></div>
    {layer === 'occupation' && <div className="occupancy-status" role="status">
      <strong>Occupation du terrain</strong>
      {occupancy.precomputed && <span>{occupancy.precomputed} · analyse disponible</span>}
      {!occupancy.liveAvailable ? <span>Analyse en direct non configurée.</span>
        : occupancy.pending > 0 ? <span>Calcul du secteur en cours…</span>
        : occupancy.toCompute > 0 ? <span>{occupancy.tooWide ? 'Vue étendue : le secteur central sera analysé en premier.' : 'Le secteur visible peut être analysé.'}</span>
        : <span>Analyse du secteur visible à jour.</span>}
      {occupancy.liveAvailable && occupancy.toCompute > 0 && <button className="occupancy-start" disabled={props.drawing || !!props.placingDroneId} onClick={occupancy.start}>Lancer le calcul</button>}
      {occupancy.error && <span className="occupancy-error">{occupancy.error} <button disabled={props.drawing || !!props.placingDroneId} onClick={occupancy.retry}>Réessayer</button></span>}
      <small>Aide au choix d’un emplacement · à vérifier sur le terrain</small>
    </div>}
    {tileError && <div className="tile-notice" role="status">{layer === 'satellite' ? 'Imagerie IGN indisponible sur ce secteur.' : 'Fond cartographique indisponible.'} Les zones restent accessibles.{layer === 'satellite' && <button disabled={props.drawing} onClick={() => setLayer('plan')}>Revenir au plan</button>}</div>}
    <div ref={container} className={`mission-map ${props.drawing || props.placingDroneId ? 'drawing' : ''}`} role="region" aria-label="Carte de mission" />
    {layer === 'occupation'
      ? <div className="map-legend occupancy-legend" aria-label="Légende de l’occupation"><strong>Occupation</strong>{(Object.keys(OCCUPANCY_STYLES) as (keyof typeof OCCUPANCY_STYLES)[]).map(status => <span key={status}><i className="legend-swatch" style={{ background: OCCUPANCY_STYLES[status].color, borderColor: OCCUPANCY_STYLES[status].color }} />{OCCUPANCY_STYLES[status].label}</span>)}</div>
      : <div className="map-legend" aria-label="Légende cartographique"><strong>Légende</strong><span><i className="legend-swatch operation-swatch" />Zone d’opération</span><span><i className="legend-swatch coverage-swatch" />Zone de travail drone</span><span><i className="legend-swatch" style={{ background: '#ffd43b', borderColor: '#c69a00' }} />Chevauchement des drones</span><span><i className="legend-swatch exterior-swatch" />Portée hors zone · dans le secteur</span><span className="priority-legend"><i className="legend-swatch priority-swatch" />Zone prioritaire</span><span><i className="legend-dot" />Non couvert · estimation</span><span className="legend-markers"><b>D</b> Drone <b>T</b> Télépilote</span></div>}
  </div>;
}
