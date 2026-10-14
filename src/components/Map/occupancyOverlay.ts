import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import {
  LIVE_CONCURRENCY, MAX_LIVE_TILES, OCCUPANCY_STYLES, TAKEOFF_LABELS, UAS_RESTRICTIONS_URL,
  fetchOccupancyTile, loadCommuneManifest, loadCommuneOccupancy, loadFeedback, occupancyApiUrl, sendFeedback, tileCoveredBy, tilesFor,
  type CommuneManifestEntry, type CommuneOccupancy, type OccupancyMap, type TakeoffFeedback, type Tile, type TileKey,
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
  feedbackCount: number;
}

// Session caches shared by every map instance.
const tileCache = new Map<TileKey, OccupancyMap | Error>();
const communeCache = new Map<string, Promise<CommuneOccupancy | null>>();
let manifestCache: Promise<CommuneManifestEntry[]> | null = null;

type FeedbackHandler = (position: [number, number], verdict: TakeoffFeedback['verdict']) => void;

function render(data: OccupancyMap, renderer: L.Renderer, interactive: boolean, onFeedback: FeedbackHandler | null): L.LayerGroup {
  const group = L.layerGroup();
  for (const zone of data.zones) {
    const style = OCCUPANCY_STYLES[zone.status] ?? { label: zone.label, color: '#888888' };
    // Opaque fills; the pane carries the transparency, so overlapping tiles never darken.
    const layer = L.geoJSON(zone.geometry, { style: { renderer, interactive, stroke: false, fillColor: style.color, fillOpacity: 1 } });
    if (interactive) {
      let clicked: L.LatLng | null = null;
      layer.on('click', (event: L.LeafletMouseEvent) => { clicked = event.latlng; });
      layer.bindPopup(() => {
        const popup = document.createElement('div');
        popup.className = 'occupancy-popup';
        const title = document.createElement('strong'); title.textContent = style.label + (zone.quality ? ` · qualité ${zone.quality}` : '');
        const verdict = document.createElement('div'); verdict.textContent = TAKEOFF_LABELS[zone.takeoff];
        const cause = document.createElement('div'); cause.textContent = zone.reason_label ?? '';
        popup.append(title, verdict, cause);
        if (onFeedback && clicked) {
          const position: [number, number] = [Number(clicked.lng.toFixed(6)), Number(clicked.lat.toFixed(6))];
          const actions = document.createElement('div'); actions.className = 'occupancy-feedback';
          const label = document.createElement('small'); label.textContent = 'Retour terrain :';
          const ok = document.createElement('button'); ok.textContent = '✓ Vérifié OK';
          const ko = document.createElement('button'); ko.textContent = '✕ Impossible en vrai';
          ok.onclick = () => { onFeedback(position, 'ok'); actions.replaceChildren('Merci, enregistré.'); };
          ko.onclick = () => { onFeedback(position, 'impossible'); actions.replaceChildren('Merci, enregistré.'); };
          actions.append(label, ok, ko);
          popup.append(actions);
        }
        return popup;
      });
    }
    layer.addTo(group);
  }
  return group;
}

/**
 * Occupancy overlay for the « Occupation » map mode. Inactive: nothing is loaded or requested.
 * Active: shows the precomputed communes in view, then computes missing tiles on demand.
 */
export function useOccupancyOverlay(map: L.Map | null, active: boolean, interactive: boolean, showRestrictions: boolean) {
  const [progress, setProgress] = useState<OccupancyProgress>({ precomputed: null, pending: 0, done: 0, failed: 0, tooWide: false, toCompute: 0, liveAvailable: !!occupancyApiUrl(), error: null, feedbackCount: 0 });
  const groups = useRef(new Map<string, L.LayerGroup>());
  const [revision, setRevision] = useState(0);
  const startRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!map || !active || !showRestrictions) return;
    // Official UAS restriction areas (Géoportail), drawn above the occupancy colours.
    if (!map.getPane('uas')) map.createPane('uas').style.zIndex = '360';
    const layer = L.tileLayer(UAS_RESTRICTIONS_URL, { pane: 'uas', opacity: 0.75, maxNativeZoom: 15, maxZoom: 19, minZoom: 3,
      attribution: '&copy; IGN / DGAC · restrictions UAS' }).addTo(map);
    return () => { map.removeLayer(layer); };
  }, [map, active, showRestrictions]);

  useEffect(() => {
    if (!map || !active) return;
    if (!map.getPane('occupancy')) map.createPane('occupancy').style.zIndex = '350';
    const renderer = L.canvas({ pane: 'occupancy', padding: 0.3 });
    const controller = new AbortController();
    const apiUrl = occupancyApiUrl();
    const communes: CommuneOccupancy[] = [];
    // Live queue: nearest-to-centre tiles first, LIVE_CONCURRENCY tiles computed at a time.
    let queue: Tile[] = [];
    let waiting: Tile[] = [];
    const inFlight = new Set<TileKey>();
    const tilesByKey = new Map<TileKey, Tile>();
    const pendingLayer = L.layerGroup().addTo(map);
    const feedbackLayer = L.layerGroup().addTo(map);
    const drawFeedback = (item: TakeoffFeedback) => {
      const ok = item.verdict === 'ok';
      L.circleMarker([item.position[1], item.position[0]], { radius: 7, weight: 2, color: '#ffffff', fillColor: ok ? '#1f9d55' : '#c0392b', fillOpacity: 1, pane: 'markerPane' })
        .bindTooltip(`${ok ? 'Vérifié OK' : 'Impossible en vrai'}${item.recorded_at ? ` · ${item.recorded_at.slice(0, 10)}` : ''}${item.comment ? ` · ${item.comment}` : ''}`)
        .addTo(feedbackLayer);
    };
    const onFeedback: FeedbackHandler | null = apiUrl ? (position, verdict) => {
      void sendFeedback(apiUrl, { position, verdict }).then(saved => {
        drawFeedback(saved); setProgress(p => ({ ...p, feedbackCount: p.feedbackCount + 1 }));
      }).catch((error: unknown) => setProgress(p => ({ ...p, error: error instanceof Error ? error.message : 'Retour non enregistré.' })));
    } : null;
    const show = (key: string, data: OccupancyMap) => {
      groups.current.get(key)?.remove();
      groups.current.set(key, render(data, renderer, interactive, onFeedback).addTo(map));
      // Precomputed communes stay on top of live tiles that overlap their border.
      if (!key.startsWith('commune:')) groups.current.forEach((group, name) => { if (name.startsWith('commune:')) group.eachLayer(layer => (layer as L.GeoJSON).bringToFront()); });
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
        .filter(tile => !tileCoveredBy(communes, tile.bbox));
      visible.forEach(tile => { const cached = tileCache.get(tile.key); if (cached && !(cached instanceof Error) && !groups.current.has(tile.key)) show(tile.key, cached); });
      const centre = bounds.getCenter();
      const distance = (tile: Tile) => Math.hypot(((tile.bbox[0] + tile.bbox[2]) / 2 - centre.lng) * Math.cos(centre.lat * Math.PI / 180), (tile.bbox[1] + tile.bbox[3]) / 2 - centre.lat);
      const missing = visible.filter(tile => !tileCache.has(tile.key) && !inFlight.has(tile.key) && !queue.some(queued => queued.key === tile.key)).sort((a, b) => distance(a) - distance(b));
      // Nothing is computed until the user asks: the button queues the visible missing tiles.
      waiting = missing;
      setProgress(p => ({ ...p, toCompute: missing.length, tooWide: missing.length > MAX_LIVE_TILES,
        failed: visible.filter(tile => tileCache.get(tile.key) instanceof Error).length }));
    }

    /** Loads the precomputed communes intersecting the view (each file is a few MB). */
    async function loadVisibleCommunes() {
      manifestCache ??= loadCommuneManifest();
      const manifest = await manifestCache;
      const bounds = map!.getBounds();
      const wanted = manifest.filter(item => bounds.intersects(L.latLngBounds([item.bbox[1], item.bbox[0]], [item.bbox[3], item.bbox[2]])));
      await Promise.all(wanted.map(async item => {
        if (!communeCache.has(item.insee)) communeCache.set(item.insee, loadCommuneOccupancy(item.insee).catch(() => null));
        const data = await communeCache.get(item.insee)!;
        if (!data || controller.signal.aborted || groups.current.has(`commune:${item.insee}`)) return;
        communes.push(data);
        show(`commune:${item.insee}`, data.occupancy);
      }));
      if (controller.signal.aborted) return;
      const names = communes.map(c => c.commune.name);
      setProgress(p => ({ ...p, precomputed: names.length ? names.length > 3 ? `${names.length} communes précalculées` : names.join(', ') : null }));
      refresh();
    }

    startRef.current = () => {
      const keys = new Set(queue.map(tile => tile.key));
      queue = [...queue, ...waiting.filter(tile => !keys.has(tile.key) && !inFlight.has(tile.key))].slice(0, MAX_LIVE_TILES);
      waiting = [];
      setProgress(p => ({ ...p, toCompute: 0, error: null }));
      pump();
    };

    void loadVisibleCommunes();
    if (apiUrl) void loadFeedback(apiUrl, controller.signal).then(list => { list.forEach(drawFeedback); setProgress(p => ({ ...p, feedbackCount: list.length })); }).catch(() => undefined);
    const onMove = () => { void loadVisibleCommunes(); };
    map.on('moveend resize', onMove);
    return () => {
      controller.abort();
      map.off('moveend resize', onMove);
      pendingLayer.remove();
      feedbackLayer.remove();
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
