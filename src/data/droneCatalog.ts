import type { DroneCapability, DroneModel } from '../types/drone';

export const DRONE_CAPABILITIES: readonly DroneCapability[] = [
  {
    id: 'tp1-in-sight', pilotQualification: 'TP1', flightMode: 'in_sight',
    rangeMeters: null, maxAltitudeMetersAgl: { rural: 120, urban: 120 },
  },
  {
    id: 'tp1-out-of-sight', pilotQualification: 'TP1', flightMode: 'out_of_sight',
    rangeMeters: 1000, maxAltitudeMetersAgl: { rural: 50, urban: 80 },
  },
  {
    id: 'tp2-out-of-sight', pilotQualification: 'TP2', flightMode: 'out_of_sight',
    rangeMeters: 2000, maxAltitudeMetersAgl: { rural: 120, urban: 120 },
  },
];

export const DRONE_CATALOG: readonly DroneModel[] = [
  { id: 'dji-matrice-4t', name: 'DJI Matrice 4T', incompatibleWithRain: false, capabilities: DRONE_CAPABILITIES },
  { id: 'dji-mavic-3-enterprise', name: 'DJI Mavic 3 Enterprise', incompatibleWithRain: false, capabilities: DRONE_CAPABILITIES },
  { id: 'dji-mini-5', name: 'DJI Mini 5', incompatibleWithRain: true, capabilities: DRONE_CAPABILITIES },
];
