import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import {
  MAX_LIVE_TILES, OCCUPANCY_STYLES, PRECOMPUTED_COMMUNES, TAKEOFF_LABELS,
  fetchOccupancyTile, loadCommuneOccupancy, occupancyApiUrl, tileCoveredBy, tilesFor,
  type CommuneOccupancy, type OccupancyMap, type TileKey,
} from '../../services/occupancy';

export interface OccupancyProgress {
  precomputed: string | null;
  pending: number;
  done: number;
  failed: number;
  tooWide: boolean;
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
    const layer = L.geoJSON(zone.geometry, { style: { renderer, interactive, stroke: false, fillColor: style.color, fillOpacity: 0.55 } });
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
export function useOccupancyOverlay(map: L.Map | null, active: boolean, interactive: boolean): OccupancyProgress & { retry: () => void } {
  const [progress, setProgress] = useState<OccupancyProgress>({ precomputed: null, pending: 0, done: 0, failed: 0, tooWide: false, liveAvailable: !!occupancyApiUrl(), error: null });
  const groups = useRef(new Map<string, L.LayerGroup>());
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!map || !active) return;
    if (!map.getPane('occupancy')) map.createPane('occupancy').style.zIndex = '350';
    const renderer = L.canvas({ pane: 'occupancy', padding: 0.3 });
    const controller = new AbortController();
    const apiUrl = occupancyApiUrl();
    let commune: CommuneOccupancy | null = null;
    let running = false;
    let rerun = false; // the view moved during a computation: refresh afterwards
    const show = (key: string, data: OccupancyMap) => {
      groups.current.get(key)?.remove();
      const group = render(data, renderer, interactive).addTo(map);
      groups.current.set(key, group);
    };

    async function refresh() {
      const bounds = map!.getBounds();
      const visible = tilesFor(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth())
        .filter(tile => !tileCoveredBy(commune, tile.bbox));
      visible.forEach(tile => { const cached = tileCache.get(tile.key); if (cached && !(cached instanceof Error) && !groups.current.has(tile.key)) show(tile.key, cached); });
      const centre = bounds.getCenter();
      const distance = (tile: { bbox: number[] }) => Math.hypot((tile.bbox[0]! + tile.bbox[2]!) / 2 - centre.lng, (tile.bbox[1]! + tile.bbox[3]!) / 2 - centre.lat);
      // Centre of the screen first: what the user looks at appears first.
      const missing = visible.filter(tile => !tileCache.has(tile.key)).sort((a, b) => distance(a) - distance(b));
      const tooWide = visible.length > MAX_LIVE_TILES;
      setProgress(p => ({ ...p, tooWide, pending: apiUrl && !tooWide ? missing.length : 0,
        failed: visible.filter(tile => tileCache.get(tile.key) instanceof Error).length }));
      if (!apiUrl || tooWide) return;
      if (running) { rerun = true; return; }
      running = true;
      try {
        for (const tile of missing) {
          if (controller.signal.aborted) return;
          // The view may have moved meanwhile: only compute tiles still visible.
          if (!map!.getBounds().intersects(L.latLngBounds([tile.bbox[1], tile.bbox[0]], [tile.bbox[3], tile.bbox[2]]))) {
            setProgress(p => ({ ...p, pending: Math.max(0, p.pending - 1) }));
            continue;
          }
          try {
            const data = await fetchOccupancyTile(apiUrl, tile, controller.signal);
            tileCache.set(tile.key, data);
            if (!controller.signal.aborted) show(tile.key, data);
            setProgress(p => ({ ...p, done: p.done + 1, pending: Math.max(0, p.pending - 1), error: null }));
          } catch (error) {
            if (controller.signal.aborted) return;
            const failure = error instanceof Error ? error : new Error('Calcul impossible.');
            // An unreachable service is not cached: it can be started later.
            if (!failure.message.includes('injoignable')) tileCache.set(tile.key, failure);
            setProgress(p => ({ ...p, failed: p.failed + 1, pending: Math.max(0, p.pending - 1), error: failure.message }));
            if (failure.message.includes('injoignable')) return;
          }
        }
      } finally {
        running = false;
        if (rerun && !controller.signal.aborted) { rerun = false; void refresh(); }
      }
    }

    communeCache ??= Promise.all(PRECOMPUTED_COMMUNES.map(code => loadCommuneOccupancy(code).catch(() => null))).then(list => list.find(Boolean) ?? null);
    void communeCache.then(data => {
      if (controller.signal.aborted) return;
      commune = data;
      if (data) { show('commune', data.occupancy); setProgress(p => ({ ...p, precomputed: data.commune.name })); }
      void refresh();
    });
    const onMove = () => { void refresh(); };
    map.on('moveend', onMove);
    return () => {
      controller.abort();
      map.off('moveend', onMove);
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
  return { ...progress, retry };
}
