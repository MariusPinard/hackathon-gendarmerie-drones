import type { Coordinates, CoverageArea } from './geo';

export type DroneModelId = string;
export type DroneStatus =
  | 'reserve' | 'ready' | 'active' | 'unavailable' | 'returning'
  | 'emergency_landing' | 'completed';
export type Environment = 'rural' | 'urban';

/** Hackathon scenarios, not manufacturer specifications or legal guidance. */
export interface DroneCapability {
  id: string;
  pilotQualification: 'TP1' | 'TP2';
  flightMode: 'in_sight' | 'out_of_sight';
  rangeMeters: number | null;
  maxAltitudeMetersAgl: Record<Environment, number>;
}

export interface DroneModel {
  id: DroneModelId;
  name: string;
  incompatibleWithRain: boolean;
  nightCapable?: boolean;
  windResistanceMetersPerSecond?: number;
  zoom?: string;
  specificationSource?: string;
  manufacturerRainProtection?: string;
  capabilities: readonly DroneCapability[];
}

export interface Pilot {
  id: string;
  name: string;
  qualification: 'TP1' | 'TP2';
  pilotPosition: Coordinates;
}

export interface DroneInstance {
  id: string;
  modelId: DroneModelId;
  capabilityId: string;
  pilotId: string;
  dronePosition: Coordinates;
  altitudeMetersAgl: number;
  coverage: CoverageArea;
  status: DroneStatus;
}

export interface AvailableResources {
  dronesByModel: Record<DroneModelId, number>;
}

export interface ResourceEstimate {
  dronesByModel: Record<DroneModelId, number>;
  pilotCount: number;
  assumptions: string[];
}
