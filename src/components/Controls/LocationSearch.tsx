import { useEffect, useRef, useState } from 'react';
import type { Coordinates } from '../../types/geo';
import { searchAddresses } from '../../services/geocoding';
import type { AddressResult } from '../../services/geocoding';

export function LocationSearch({ center, disabled = false, onLocate, onError }: {
  center: Coordinates; disabled?: boolean; onLocate: (point: Coordinates, label: string) => void; onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<'address' | 'coordinates'>('address');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AddressResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [latitude, setLatitude] = useState(String(center[1]));
  const [longitude, setLongitude] = useState(String(center[0]));
  const [focused, setFocused] = useState(false);
  const [revision, setRevision] = useState(0);
  const selectedQuery = useRef('');
  const selectedAddress = useRef<AddressResult | null>(null);
  const cache = useRef(new Map<string, AddressResult[]>());
  useEffect(() => { setLatitude(String(center[1])); setLongitude(String(center[0])); }, [center[0], center[1]]);
  useEffect(() => {
    setResults([]); setSearched(false); setLoading(false);
    if (disabled || mode !== 'address' || query.trim().length < 4 || query === selectedQuery.current) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const key = query.trim().toLocaleLowerCase('fr');
      const existing = cache.current.get(key);
      if (existing) { setResults(existing); setSearched(true); return; }
      setLoading(true);
      void searchAddresses(query, { signal: controller.signal }).then(found => {
        if (controller.signal.aborted) return;
        if (cache.current.size >= 30) cache.current.clear();
        cache.current.set(key, found); setResults(found); setSearched(true);
      }).catch(error => {
        if (!controller.signal.aborted) onError(error instanceof Error ? error.message : 'Recherche impossible.');
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 600);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, mode, disabled, revision]);
  function locateCoordinates() {
    const point: Coordinates = [Number(longitude), Number(latitude)];
    if (!longitude.trim() || !latitude.trim() || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 75) {
      onError('Coordonnées invalides : longitude −180 à 180°, latitude −75 à 75°.'); return;
    }
    selectedQuery.current = ''; selectedAddress.current = null;
    setFocused(false); onLocate(point, `${latitude}, ${longitude}`);
  }
  return <div className={`location-search ${disabled ? 'locked' : ''}`}>
    <div className="search-tabs"><button disabled={disabled} aria-pressed={mode === 'address'} onClick={() => { setMode('address'); setFocused(true); }}>Adresse</button><button disabled={disabled} aria-pressed={mode === 'coordinates'} onClick={() => { setMode('coordinates'); setFocused(true); }}>Coordonnées</button></div>
    {mode === 'address' ? <form className="search-input-row" onSubmit={event => { event.preventDefault(); if (query.trim().length < 4) onError('Saisissez au moins quatre caractères.'); else if (selectedAddress.current && selectedAddress.current.label === query) onLocate([...selectedAddress.current.coordinates], query); else { setFocused(true); setRevision(n => n + 1); } }}>
      <span aria-hidden="true">⌕</span><input aria-label="Rechercher une adresse" placeholder="Rechercher une adresse, une ville…" value={query} disabled={disabled} maxLength={200} autoComplete="off"
        aria-controls="address-results" aria-expanded={focused && results.length > 0} onFocus={() => setFocused(true)} onChange={e => { selectedQuery.current = ''; setQuery(e.target.value); setFocused(true); }} onKeyDown={e => { if (e.key === 'Escape') setFocused(false); }} />
      <button disabled={disabled || loading} aria-label="Rechercher">{loading ? '◌' : '→'}</button>
    </form> : <form className="coordinate-search" onSubmit={e => { e.preventDefault(); locateCoordinates(); }}>
      <label>Latitude<input aria-label="Latitude" type="number" step="any" value={latitude} disabled={disabled} onChange={e => setLatitude(e.target.value)} /></label>
      <label>Longitude<input aria-label="Longitude" type="number" step="any" value={longitude} disabled={disabled} onChange={e => setLongitude(e.target.value)} /></label><button disabled={disabled} aria-label="Centrer sur les coordonnées">→</button>
    </form>}
    {mode === 'address' && focused && !disabled && (loading || searched) && <div className="address-results" id="address-results">
      {loading ? <p>Recherche…</p> : results.length ? results.map(result => <button key={result.id} onClick={() => { selectedAddress.current = result; selectedQuery.current = result.label; setQuery(result.label); setFocused(false); setResults([]); onLocate([...result.coordinates], result.label); }}><span aria-hidden="true">⌖</span><span>{result.label}</span></button>) : <p>Aucun résultat. Précisez la ville ou utilisez les coordonnées.</p>}
      <small>Adresses : IGN · Base Adresse Nationale</small>
    </div>}
  </div>;
}
