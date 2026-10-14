import { useEffect, useId, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Coordinates, OperationZone, PriorityZone } from '../../types/geo';
import type { DroneInstance, Pilot } from '../../types/drone';
import { coveragePolygon, coveragePolygons, hasCoverage, unproject } from '../../engines/geometry/index.ts';
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
  uncoveredCellSizeMeters?: number | undefined;
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
  const overlayId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const geometryKey = JSON.stringify(props.operationZone?.geometry ?? null);
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
    return () => { resize.disconnect(); map.remove(); mapRef.current = null; layersRef.current = null; setMapInstance(null); };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    // The occupancy mode draws its overlay on the plan background.
    const source = MAP_SOURCES[layer === 'occupation' ? 'plan' : layer];
    if (!map || !source) return;
    setTileError(false);
    const tiles = L.tileLayer(source.urlTemplate, { maxZoom: source.maxZoom, attribution: source.attribution }).addTo(map);
    tiles.on('tileerror', () => setTileError(true));
    return () => { tiles.off('tileerror'); map.removeLayer(tiles); };
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
    const uncoveredLayers: L.Polygon[] = [];
    props.uncoveredPoints?.forEach(p => {
      const half = Math.max(1, props.uncoveredCellSizeMeters ?? 20) / 2;
      const cell: Coordinates[] = [[-half, -half], [half, -half], [half, half], [-half, half]].map(offset => unproject(offset as [number, number], p));
      uncoveredLayers.push(L.polygon(cell.map(latLng), { color: 'var(--map-lost)', weight: 0, fillColor: `url(#uncovered-hatch-${overlayId})`, fillOpacity: 1, interactive: false }).addTo(layers));
    });
    // The raster is an estimate from the engine's sample grid, clipped at the exact operation outline.
    const firstCellElement = uncoveredLayers[0]?.getElement();
    const svg = firstCellElement instanceof SVGElement ? firstCellElement.ownerSVGElement : null;
    let defs: SVGDefsElement | undefined;
    let updateClip: (() => void) | undefined;
    if (svg) {
      const ns = 'http://www.w3.org/2000/svg';
      defs = document.createElementNS(ns, 'defs');
      const pattern = document.createElementNS(ns, 'pattern');
      pattern.id = `uncovered-hatch-${overlayId}`; pattern.setAttribute('patternUnits', 'userSpaceOnUse'); pattern.setAttribute('width', '9'); pattern.setAttribute('height', '9');
      const background = document.createElementNS(ns, 'rect'); background.setAttribute('width', '9'); background.setAttribute('height', '9'); background.setAttribute('fill', 'var(--map-lost)'); background.setAttribute('fill-opacity', '.3');
      const hatch = document.createElementNS(ns, 'path'); hatch.setAttribute('d', 'M-2 2L2-2M0 9L9 0M7 11L11 7'); hatch.setAttribute('stroke', 'var(--map-lost)'); hatch.setAttribute('stroke-width', '2'); hatch.setAttribute('stroke-opacity', '.8');
      pattern.append(background, hatch); defs.append(pattern);
      if (props.operationZone) {
        const clip = document.createElementNS(ns, 'clipPath'); clip.id = `uncovered-clip-${overlayId}`; clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
        const path = document.createElementNS(ns, 'path'); path.setAttribute('clip-rule', 'evenodd'); clip.append(path); defs.append(clip);
        const geometry = props.operationZone.geometry;
        updateClip = () => path.setAttribute('d', geometry.coordinates.map(ring => ring.map((point, index) => {
          const xy = map.latLngToLayerPoint(latLng(point)); return `${index ? 'L' : 'M'}${xy.x} ${xy.y}`;
        }).join(' ') + 'Z').join(' '));
        updateClip(); map.on('moveend zoomend viewreset', updateClip);
        uncoveredLayers.forEach(cell => cell.getElement()?.setAttribute('clip-path', `url(#${clip.id})`));
      }
      svg.prepend(defs);
    }
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
      const conflict = props.conflictDroneIds?.includes(drone.id);
      const selected = props.selected === `drone:${drone.id}`;
      const color = conflict ? 'var(--map-conflict)' : selected ? 'var(--map-selected)' : 'var(--map-coverage)';
      if (hasCoverage(drone)) {
        const coverage = props.operationZone && drone.coverage.clipPolygon !== props.operationZone.geometry ? { ...drone.coverage, clipPolygon: props.operationZone.geometry } : drone.coverage;
        coveragePolygons(coverage).forEach(polygon => {
          const shape = rings(polygon.coordinates);
          L.polygon(shape, { color: 'var(--map-contrast-dark)', weight: selected ? 7 : 6, opacity: .85, fill: false, interactive: false }).addTo(layers);
          L.polygon(shape, { color: 'var(--map-contrast-light)', weight: selected ? 5 : 4, opacity: .95, fill: false, interactive: false }).addTo(layers);
          L.polygon(shape, { color, weight: selected ? 3 : 2, fillOpacity: selected ? .24 : .13, interactive: false }).addTo(layers);
        });
        if (selected) {
          const arc = coveragePolygon({ ...drone.coverage, workingAngleDegrees: 1 }).coordinates[0]!;
          const tip = arc[2]!;
          L.polyline([latLng(drone.dronePosition), latLng(tip)], { color, weight: 2.5, dashArray: '6 4', interactive: false }).addTo(layers);
          L.marker(latLng(tip), { interactive: false, keyboard: false, icon: L.divIcon({ className: 'heading-arrow', html: `<span style="transform:rotate(${drone.coverage.headingDegrees}deg)">↑</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(layers);
        }
      }
      const marker = L.marker(latLng(drone.dronePosition), { draggable: interactive && hasCoverage(drone), interactive: selectable, keyboard: selectable,
        icon: L.divIcon({ className: `drone-marker ${selected ? 'selected' : ''} ${conflict ? 'conflict' : ''} ${drone.status}`,
          html: `<span>D${index + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(layers);
      marker.bindTooltip(`D${index + 1} · ${drone.altitudeMetersAgl.toFixed(0)} m`);
      marker.on('click', () => { if (!callbacks.current.drawing && !callbacks.current.placingDroneId) callbacks.current.onSelect?.(`drone:${drone.id}`); });
      marker.on('dragend', () => { const p = marker.getLatLng(); callbacks.current.onMoveDrone?.(drone.id, [p.lng, p.lat]); });
    });
    // Keep the operation outline identifiable where a clipped drone area shares its boundary.
    if (props.operationZone) {
      L.polygon(rings(props.operationZone.geometry.coordinates), { color: 'var(--map-contrast-light)', weight: 7, fill: false, opacity: 0.95, interactive: false }).addTo(layers);
      L.polygon(rings(props.operationZone.geometry.coordinates), { color: 'var(--map-operation)', weight: 3.5, fill: false, interactive: false }).addTo(layers);
    }
    return () => { if (updateClip) map.off('moveend zoomend viewreset', updateClip); defs?.remove(); };
  }, [props]);
  return <div className={`map-wrap ${layer === 'satellite' ? 'satellite-map' : ''} ${props.drawing ? 'draw-lock' : ''}`}>
    <button className="map-center square-tool" disabled={props.drawing || !!props.placingDroneId || !props.operationZone} onClick={() => {
      if (props.operationZone) mapRef.current?.fitBounds(L.latLngBounds(props.operationZone.geometry.coordinates[0]!.map(latLng)), { padding: [100, 70], maxZoom: 15 });
    }} aria-label="Centrer la carte sur la zone d’opération" title="Centrer sur la zone d’opération"><span className="tool-icon" aria-hidden="true">⌖</span><span>Centrer la carte</span></button>
    <div className="map-toolbar" aria-label="Fond cartographique"><button aria-pressed={layer === 'plan'} disabled={props.drawing} onClick={() => setLayer('plan')}>Plan</button><button aria-pressed={layer === 'satellite'} disabled={props.drawing} onClick={() => setLayer('satellite')}>Satellite</button><button aria-pressed={layer === 'occupation'} disabled={props.drawing} onClick={() => setLayer('occupation')} title="Où un télépilote peut décoller (données ouvertes, à vérifier sur le terrain)">Occupation</button></div>
    {layer === 'occupation' && <div className="occupancy-status" role="status">
      <strong>Occupation au décollage</strong>
      {occupancy.precomputed && <span>{occupancy.precomputed} : carte précalculée</span>}
      {occupancy.tooWide ? <span>Zoomez pour calculer hors de la zone précalculée.</span>
        : occupancy.pending > 0 ? <span>Calcul en cours · {occupancy.pending} tuile(s) restante(s), ~15 s chacune</span>
        : !occupancy.liveAvailable && <span>Calcul en direct non configuré.</span>}
      {occupancy.error && <span className="occupancy-error">{occupancy.error} <button onClick={occupancy.retry}>Réessayer</button></span>}
      <small>Aide à la décision · vérification terrain obligatoire</small>
    </div>}
    {tileError && <div className="tile-notice" role="status">{layer === 'satellite' ? 'Imagerie IGN indisponible sur ce secteur.' : 'Fond cartographique indisponible.'} Les zones restent accessibles.{layer === 'satellite' && <button disabled={props.drawing} onClick={() => setLayer('plan')}>Revenir au plan</button>}</div>}
    <div ref={container} className={`mission-map ${props.drawing || props.placingDroneId ? 'drawing' : ''}`} role="region" aria-label="Carte de mission" />
    {layer === 'occupation'
      ? <div className="map-legend" aria-label="Légende de l’occupation"><strong>Occupation</strong>{(['free', 'free_unconfirmed', 'no_access', 'steep', 'obstacle_buffer', 'occupied'] as const).map(status => <span key={status}><i className="legend-swatch" style={{ background: OCCUPANCY_STYLES[status].color, borderColor: OCCUPANCY_STYLES[status].color }} />{OCCUPANCY_STYLES[status].label}</span>)}<span className="legend-markers"><b>D</b> Drone <b>T</b> Télépilote</span></div>
      : <div className="map-legend" aria-label="Légende cartographique"><strong>Légende</strong><span><i className="legend-swatch operation-swatch" />Zone d’opération</span><span><i className="legend-swatch coverage-swatch" />Zone de travail drone</span><span className="priority-legend"><i className="legend-swatch priority-swatch" />Zone prioritaire</span><span className="lost-legend"><i className="legend-swatch lost-swatch" />Non couvert · estimation</span><span className="legend-markers"><b>D</b> Drone <b>T</b> Télépilote</span></div>}
  </div>;
}
