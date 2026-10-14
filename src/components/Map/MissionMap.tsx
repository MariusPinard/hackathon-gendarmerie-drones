import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Coordinates, OperationZone, PriorityZone } from '../../types/geo';
import type { DroneInstance, Pilot } from '../../types/drone';
import { coveragePolygon, hasCoverage } from '../../engines/geometry/index.ts';
import { MAP_SOURCES } from './mapSources';

interface MapProps {
  center: Coordinates;
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
  const geometryKey = JSON.stringify(props.operationZone?.geometry ?? null);
  const [longitude, latitude] = props.center;
  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, { doubleClickZoom: false }).setView(latLng(callbacks.current.center), 12);
    const source = MAP_SOURCES.plan;
    const tiles = L.tileLayer(source.urlTemplate, {
      maxZoom: source.maxZoom, attribution: source.attribution,
    }).addTo(map);
    tiles.on('tileerror', () => setTileError(true));
    mapRef.current = map;
    layersRef.current = L.layerGroup().addTo(map);
    map.on('click', (event: L.LeafletMouseEvent) => {
      if (callbacks.current.drawing) callbacks.current.onVertex?.([event.latlng.lng, event.latlng.lat]);
    });
    map.on('dblclick', () => { if (callbacks.current.drawing) callbacks.current.onFinish?.(); });
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(container.current);
    return () => { resize.disconnect(); map.remove(); mapRef.current = null; layersRef.current = null; };
  }, []);
  useEffect(() => { mapRef.current?.setView([latitude, longitude]); }, [latitude, longitude]);
  useEffect(() => {
    if (props.operationZone) mapRef.current?.fitBounds(L.latLngBounds(props.operationZone.geometry.coordinates[0]!.map(latLng)), { padding: [32, 32], maxZoom: 15 });
  }, [geometryKey]);
  useEffect(() => {
    const layers = layersRef.current;
    if (!layers) return;
    layers.clearLayers();
    if (props.operationZone) L.polygon(rings(props.operationZone.geometry.coordinates), { color: '#174d80', weight: 3, fillOpacity: 0.04, interactive: false }).addTo(layers);
    props.priorityZones.forEach(z => L.polygon(rings(z.geometry.coordinates), { color: '#b76b0d', weight: 2, fillColor: '#efa642', fillOpacity: 0.25, interactive: false }).addTo(layers));
    props.uncoveredPoints?.forEach(p => L.circleMarker(latLng(p), { radius: 2, color: '#a3273c', weight: 0, fillOpacity: 0.6, interactive: false }).addTo(layers));
    const vertices = props.vertices ?? [];
    if (vertices.length) {
      L.polyline(vertices.map(latLng), { color: '#477dc0', dashArray: '5 5', interactive: false }).addTo(layers);
      vertices.forEach(p => L.circleMarker(latLng(p), { radius: 4, color: '#174d80', fillOpacity: 1, interactive: false }).addTo(layers));
    }
    props.pilots?.forEach((pilot, index) => {
      const marker = L.marker(latLng(pilot.pilotPosition), { draggable: props.editable ?? false,
        icon: L.divIcon({ className: 'pilot-marker', html: `<span>T${index + 1}</span>`, iconSize: [28, 28], iconAnchor: [40, -6] }) }).addTo(layers);
      const label = document.createElement('span');
      label.textContent = pilot.name;
      marker.bindTooltip(label);
      marker.on('click', () => callbacks.current.onSelect?.(`pilot:${pilot.id}`));
      marker.on('dragend', () => { const p = marker.getLatLng(); callbacks.current.onMovePilot?.(pilot.id, [p.lng, p.lat]); });
    });
    props.drones?.forEach((drone, index) => {
      const conflict = props.conflictDroneIds?.includes(drone.id);
      const color = conflict ? '#b4233a' : '#236bb1';
      if (hasCoverage(drone)) {
        if (drone.coverage.workingAngleDegrees === 360) L.circle(latLng(drone.dronePosition), { radius: drone.coverage.radiusMeters, color, weight: 1.5, fillOpacity: 0.12, interactive: false }).addTo(layers);
        else L.polygon(rings(coveragePolygon(drone.coverage).coordinates), { color, weight: 1.5, fillOpacity: 0.16, interactive: false }).addTo(layers);
      }
      const selected = props.selected === `drone:${drone.id}`;
      const marker = L.marker(latLng(drone.dronePosition), { draggable: (props.editable ?? false) && hasCoverage(drone),
        icon: L.divIcon({ className: `drone-marker ${selected ? 'selected' : ''} ${conflict ? 'conflict' : ''} ${drone.status}`,
          html: `<span>D${index + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(layers);
      marker.bindTooltip(`D${index + 1} · ${drone.altitudeMetersAgl.toFixed(0)} m`);
      marker.on('click', () => callbacks.current.onSelect?.(`drone:${drone.id}`));
      marker.on('dragend', () => { const p = marker.getLatLng(); callbacks.current.onMoveDrone?.(drone.id, [p.lng, p.lat]); });
    });
  }, [props]);
  return <div className="map-wrap">
    <div className="map-toolbar"><span className="badge">Vue plan</span><span className="muted">Satellite : source autorisée à configurer</span></div>
    {tileError && <p className="notice">Fond cartographique indisponible. Les zones et le dispositif restent utilisables.</p>}
    <div ref={container} className={`mission-map ${props.drawing ? 'drawing' : ''}`} role="region" aria-label="Carte de mission" />
    <div className="map-legend"><span>● Zone opération</span><span className="priority-legend">● Priorité</span><span>● Drone D / télépilote T</span><span className="lost-legend">● Points non couverts</span></div>
  </div>;
}
