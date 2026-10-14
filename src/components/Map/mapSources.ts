/** Configured sources only: URLs, attribution and zoom belong to the UI adapter. */
export interface MapSource {
  urlTemplate: string;
  attribution: string;
  maxZoom: number;
}

export const MAP_SOURCES: { plan: MapSource; satellite: MapSource | null } = {
  plan: {
    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  },
  // Public IGN orthophotos for France; no API key is embedded.
  satellite: {
    urlTemplate: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM_0_19&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    attribution: '&copy; <a href="https://cartes.gouv.fr/" target="_blank" rel="noreferrer">IGN / Géoplateforme</a>',
    maxZoom: 19,
  },
};
