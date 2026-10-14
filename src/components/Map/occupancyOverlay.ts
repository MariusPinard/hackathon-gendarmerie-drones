import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import {
  LIVE_CONCURRENCY, MAX_LIVE_TILES, OCCUPANCY_STYLES, PRECOMPUTED_COMMUNES, TAKEOFF_LABELS,
  fetchOccupancyTile, loadCommuneOccupancy, occupancyApiUrl, tileCoveredBy, tilesFor,
  type CommuneOccupancy, type OccupancyMap, type Tile, type TileKey,
} from '../../services/occupancy';

export interface OccupancyProgress {
  precomputed: string | null;
  pending: number;
  done: number;
  failed: number;
  tooWide: boolean;
  /** Visible tiles not computed yet, waiting for « Lancer le calcul ». */
  toCompute: number;
  liveAvailable: boolean;
  error: string | null;
}

// Session cache shared by every map instance: a tile is computed once per page load.
const tileCache = new Map<TileKey, OccupancyMap | Error>();
let communeCache: Promise<CommuneOccupancy | null> | null = null;

function render(data: OccupancyMap, renderer: L.Renderer, interactive: boolean): L.LayerGroup {
  const group = L.layerGroup();
  for (const zone of data.zones) {
    const style = OCCUPANCY_STYLES[zone.status];
    // Opaque fills; the pane carries the transparency, so overlapping tiles never darken.
    const layer = L.geoJSON(zone.geometry, { style: { renderer, interactive, stroke: false, fillColor: style.color, fillOpacity: 1 } });
    if (interactive) {
      const popup = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = style.label;
      const verdict = document.createElement('div'); verdict.textContent = TAKEOFF_LABELS[zone.takeoff];
      const cause = document.createElement('div'); cause.textContent = zone.reason_label ?? '';
      popup.append(title, verdict, cause);
      layer.bindPopup(popup);
    }
    layer.addTo(group);
  }
  return group;
}

/**
 * Occupancy overlay for the « Occupation » map mode. Inactive: nothing is loaded or requested.
 * Active: shows the precomputed commune map, then requests the missing visible tiles one at a time.
 */
export function useOccupancyOverlay(map: L.Map | null, active: boolean, interactive: boolean): OccupancyProgress & { retry: () => void; start: () => void } {
  const [progress, setProgress] = useState<OccupancyProgress>({ precomputed: null, pending: 0, done: 0, failed: 0, tooWide: false, toCompute: 0, liveAvailable: !!occupancyApiUrl(), error: null });
  const groups = useRef(new Map<string, L.LayerGroup>());
  const [revision, setRevision] = useState(0);
  const startRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!map || !active) return;
    if (!map.getPane('occupancy')) map.createPane('occupancy').style.zIndex = '350';
    const renderer = L.canvas({ pane: 'occupancy', padding: 0.3 });
    const controller = new AbortController();
    const apiUrl = occupancyApiUrl();
    let commune: CommuneOccupancy | null = null;
    // Live queue: nearest-to-centre tiles first, LIVE_CONCURRENCY tiles computed at a time.
    let queue: Tile[] = [];
    let waiting: Tile[] = [];
    const inFlight = new Set<TileKey>();
    const pendingLayer = L.layerGroup().addTo(map);
    const show = (key: string, data: OccupancyMap) => {
      groups.current.get(key)?.remove();
      const group = render(data, renderer, interactive).addTo(map);
      groups.current.set(key, group);
      // The precomputed commune map stays on top of live tiles that overlap its border.
      if (key !== 'commune') groups.current.get('commune')?.eachLayer(layer => (layer as L.GeoJSON).bringToFront());
    };
    const drawPending = () => {
      pendingLayer.clearLayers();
      for (const tile of [...queue, ...[...inFlight].map(key => tilesByKey.get(key)!).filter(Boolean)]) {
        L.rectangle([[tile.bbox[1], tile.bbox[0]], [tile.bbox[3], tile.bbox[2]]], {
          pane: 'occupancy', interactive: false, weight: 1.5, dashArray: '6 6', color: inFlight.has(tile.key) ? '#1264ce' : '#6b7280',
          fillColor: '#ffffff', fillOpacity: inFlight.has(tile.key) ? 0.18 : 0.08,
        }).addTo(pendingLayer);
      }
      setProgress(p => ({ ...p, pending: queue.length + inFlight.size }));
    };
    const tilesByKey = new Map<TileKey, Tile>();

    function pump() {
      if (!apiUrl || controller.signal.aborted) return;
      while (inFlight.size < LIVE_CONCURRENCY && queue.length) {
        const tile = queue.shift()!;
        inFlight.add(tile.key);
        tilesByKey.set(tile.key, tile);
        void fetchOccupancyTile(apiUrl, tile, controller.signal).then(data => {
          tileCache.set(tile.key, data);
          if (!controller.signal.aborted) show(tile.key, data);
          setProgress(p => ({ ...p, done: p.done + 1, error: null }));
        }).catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const failure = error instanceof Error ? error : new Error('Calcul impossible.');
          const unreachable = failure.message.includes('injoignable');
          // An unreachable service is not cached: it can be started later.
          if (!unreachable) tileCache.set(tile.key, failure);
          if (unreachable) queue = [];
          setProgress(p => ({ ...p, failed: p.failed + 1, error: failure.message }));
        }).finally(() => {
          inFlight.delete(tile.key);
          if (controller.signal.aborted) return;
          drawPending();
          pump();
        });
      }
      drawPending();
    }

    function refresh() {
      const bounds = map!.getBounds();
      const visible = tilesFor(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth())
        .filter(tile => !tileCoveredBy(commune, tile.bbox));
      visible.forEach(tile => { const cached = tileCache.get(tile.key); if (cached && !(cached instanceof Error) && !groups.current.has(tile.key)) show(tile.key, cached); });
      const centre = bounds.getCenter();
      const distance = (tile: Tile) => Math.hypot(((tile.bbox[0] + tile.bbox[2]) / 2 - centre.lng) * Math.cos(centre.lat * Math.PI / 180), (tile.bbox[1] + tile.bbox[3]) / 2 - centre.lat);
      // What the user looks at comes first; a wide view computes the centre and the rest follows when panning/zooming.
      const missing = visible.filter(tile => !tileCache.has(tile.key) && !inFlight.has(tile.key) && !queue.some(queued => queued.key === tile.key)).sort((a, b) => distance(a) - distance(b));
      // Nothing is computed until the user asks: the button queues the visible missing tiles.
      waiting = missing;
      setProgress(p => ({ ...p, toCompute: missing.length, tooWide: missing.length > MAX_LIVE_TILES,
        failed: visible.filter(tile => tileCache.get(tile.key) instanceof Error).length }));
    }

    startRef.current = () => {
      const keys = new Set(queue.map(tile => tile.key));
      queue = [...queue, ...waiting.filter(tile => !keys.has(tile.key) && !inFlight.has(tile.key))].slice(0, MAX_LIVE_TILES);
      waiting = [];
      setProgress(p => ({ ...p, toCompute: 0, error: null }));
      pump();
    };

    communeCache ??= Promise.all(PRECOMPUTED_COMMUNES.map(code => loadCommuneOccupancy(code).catch(() => null))).then(list => list.find(Boolean) ?? null);
    void communeCache.then(data => {
      if (controller.signal.aborted) return;
      commune = data;
      if (data) { show('commune', data.occupancy); setProgress(p => ({ ...p, precomputed: data.commune.name })); }
      refresh();
    });
    const onMove = () => refresh();
    map.on('moveend resize', onMove);
    return () => {
      controller.abort();
      map.off('moveend resize', onMove);
      pendingLayer.remove();
      startRef.current = () => undefined;
      groups.current.forEach(group => group.remove());
      groups.current.clear();
      renderer.remove();
    };
  }, [map, active, interactive, revision]);

  const retry = () => {
    for (const [key, value] of tileCache) if (value instanceof Error) tileCache.delete(key);
    setProgress(p => ({ ...p, failed: 0, error: null }));
    setRevision(r => r + 1);
  };
  return { ...progress, retry, start: () => startRef.current() };
}
