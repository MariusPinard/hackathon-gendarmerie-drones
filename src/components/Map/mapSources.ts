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
  // Choose an authorized source before exposing satellite; never embed secret keys.
  satellite: null,
};
