import type { Coordinates } from '../types/geo';

export interface AddressResult { id: string; label: string; coordinates: Coordinates }
interface GeocodingOptions { signal?: AbortSignal; fetcher?: typeof fetch }

/** Public IGN/BAN search; the UI debounces requests and cancels stale suggestions. */
export async function searchAddresses(query: string, options: GeocodingOptions = {}): Promise<AddressResult[]> {
  const normalized = query.trim();
  if (normalized.length < 4) return [];
  if (normalized.length > 200) throw new Error('Adresse trop longue (200 caractères maximum).');
  const url = new URL('https://data.geopf.fr/geocodage/search');
  url.search = new URLSearchParams({ q: normalized, limit: '5', index: 'address' }).toString();
  try {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(7000)]) : AbortSignal.timeout(7000);
    const response = await (options.fetcher ?? fetch)(url, { signal });
    if (!response.ok) throw new Error('Le service de recherche d’adresse est indisponible.');
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('features' in data) || !Array.isArray(data.features)) throw new Error('Réponse du service d’adresse invalide.');
    return data.features.slice(0, 5).flatMap((feature: unknown, index) => {
      if (!feature || typeof feature !== 'object' || !('geometry' in feature) || !('properties' in feature)) return [];
      const geometry = feature.geometry, properties = feature.properties;
      if (!geometry || typeof geometry !== 'object' || !('coordinates' in geometry) || !('type' in geometry) || geometry.type !== 'Point'
        || !Array.isArray(geometry.coordinates) || geometry.coordinates.length !== 2
        || !properties || typeof properties !== 'object' || !('label' in properties) || typeof properties.label !== 'string') return [];
      const [longitude, latitude] = geometry.coordinates;
      if (typeof longitude !== 'number' || typeof latitude !== 'number' || !Number.isFinite(longitude) || !Number.isFinite(latitude)
        || Math.abs(longitude) > 180 || Math.abs(latitude) > 75 || !properties.label.trim()) return [];
      return [{ id: `address-${index}`, label: properties.label, coordinates: [longitude, latitude] as Coordinates }];
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error(error instanceof Error && error.message.startsWith('Le service') ? error.message : 'Recherche d’adresse impossible. Réessayez ou utilisez les coordonnées.');
  }
}
