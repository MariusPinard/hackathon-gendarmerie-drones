import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Coordinates, OperationZone, PriorityZone } from '../../types/geo';
import type { DroneInstance, Pilot } from '../../types/drone';
import { coveragePolygon, hasCoverage } from '../../engines/geometry/index.ts';
import { MAP_SOURCES } from './mapSources';

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
  const [layer, setLayer] = useState<'plan' | 'satellite'>('plan');
  const geometryKey = JSON.stringify(props.operationZone?.geometry ?? null);
  const [longitude, latitude] = props.center;
  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, { doubleClickZoom: false, zoomControl: false }).setView(latLng(callbacks.current.center), 13);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    mapRef.current = map;
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
    const source = MAP_SOURCES[layer];
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
    if (!layers) return;
    layers.clearLayers();
    if (props.operationZone) L.polygon(rings(props.operationZone.geometry.coordinates), { color: 'var(--map-operation)', weight: 3, fillOpacity: 0.07, interactive: false }).addTo(layers);
    props.priorityZones.forEach(z => L.polygon(rings(z.geometry.coordinates), { color: 'var(--map-priority)', weight: 2, fillColor: 'var(--map-priority-fill)', fillOpacity: 0.28, interactive: false }).addTo(layers));
    props.uncoveredPoints?.forEach(p => L.circleMarker(latLng(p), { radius: 2, color: 'var(--map-lost)', weight: 0, fillOpacity: 0.6, interactive: false }).addTo(layers));
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
        if (drone.coverage.workingAngleDegrees === 360) L.circle(latLng(drone.dronePosition), { radius: drone.coverage.radiusMeters, color, weight: selected ? 3 : 1.5, fillOpacity: selected ? 0.2 : 0.1, interactive: false }).addTo(layers);
        else L.polygon(rings(coveragePolygon(drone.coverage).coordinates), { color, weight: selected ? 3 : 1.5, fillOpacity: 0.2, interactive: false }).addTo(layers);
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
  }, [props]);
  return <div className={`map-wrap ${layer === 'satellite' ? 'satellite-map' : ''} ${props.drawing ? 'draw-lock' : ''}`}>
    <div className="map-toolbar" aria-label="Fond cartographique"><button aria-pressed={layer === 'plan'} disabled={props.drawing} onClick={() => setLayer('plan')}>Plan</button><button aria-pressed={layer === 'satellite'} disabled={props.drawing} onClick={() => setLayer('satellite')}>Satellite</button></div>
    {tileError && <div className="tile-notice" role="status">{layer === 'satellite' ? 'Imagerie IGN indisponible sur ce secteur.' : 'Fond cartographique indisponible.'} Les zones restent accessibles.{layer === 'satellite' && <button disabled={props.drawing} onClick={() => setLayer('plan')}>Revenir au plan</button>}</div>}
    <div ref={container} className={`mission-map ${props.drawing || props.placingDroneId ? 'drawing' : ''}`} role="region" aria-label="Carte de mission" />
    <div className="map-legend"><span>● Zone opération</span><span className="priority-legend">● Priorité</span><span>D Drone / T Télépilote</span><span className="lost-legend">● Non couvert</span></div>
  </div>;
}
