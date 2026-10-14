import type { DroneCapability, DroneModel } from '../types/drone';

export const DRONE_CAPABILITIES: readonly DroneCapability[] = [
  {
    id: 'tp1-in-sight', pilotQualification: 'TP1', flightMode: 'in_sight',
    rangeMeters: 500, maxAltitudeMetersAgl: { rural: 120, urban: 120 },
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
  {
    id: 'dji-matrice-4t', name: 'DJI Matrice 4T',
    // Eligibility is the requested simulation policy, not a manufacturer rain certification.
    incompatibleWithRain: false, nightCapable: true, capabilities: DRONE_CAPABILITIES,
    windResistanceMetersPerSecond: 12,
    zoom: 'Téléobjectif : 16× numérique / 112× hybride ; thermique : 28× numérique',
    specificationSource: 'https://enterprise.dji.com/matrice-4-series/specs',
    manufacturerRainProtection: 'Non étanche selon DJI : sous la pluie, retourner et atterrir dès que possible (FAQ Matrice 4).',
  },
  {
    id: 'dji-mavic-3-enterprise', name: 'DJI Mavic 3 Enterprise',
    incompatibleWithRain: true, nightCapable: false, capabilities: DRONE_CAPABILITIES,
    windResistanceMetersPerSecond: 12,
    zoom: 'Téléobjectif : 8× numérique / 56× hybride',
    specificationSource: 'https://enterprise.dji.com/mavic-3-enterprise/specs',
    manufacturerRainProtection: 'DJI demande de ne pas voler sous la pluie (consignes de sécurité Mavic 3 Enterprise).',
  },
  {
    // Retain the existing JSON model id; DJI's current product name is Mini 5 Pro.
    id: 'dji-mini-5', name: 'DJI Mini 5 Pro',
    incompatibleWithRain: true, nightCapable: false, capabilities: DRONE_CAPABILITIES,
    windResistanceMetersPerSecond: 12,
    zoom: 'Photo 12 Mpx / 4K : 1–3× numérique ; FHD : 1–4× numérique',
    specificationSource: 'https://www.dji.com/mini-5-pro/specs',
    manufacturerRainProtection: 'Non étanche selon DJI : sous la pluie, retourner et atterrir dès que possible (FAQ Mini 5 Pro).',
  },
];
