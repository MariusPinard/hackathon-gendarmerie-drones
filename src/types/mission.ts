import type { AvailableResources, DroneInstance, Environment, Pilot, ResourceEstimate } from './drone';
import type { Coordinates, OperationZone, PriorityZone } from './geo';
import type { WeatherInfo } from './weather';

export type MissionStatus =
  | 'draft' | 'planned' | 'ready' | 'active' | 'emergency' | 'returning' | 'completed';

export interface MissionConstraints {
  environment: Environment;
  minimumVerticalSeparationMeters: number;
  defaultWorkingAngleDegrees: number;
  /** Optional for backwards-compatible 1.0 missions; old files infer from drones. */
  capabilityId?: string;
}

export const DEFAULT_MISSION_CONSTRAINTS: Readonly<MissionConstraints> = Object.freeze({
  environment: 'rural',
  minimumVerticalSeparationMeters: 10,
  defaultWorkingAngleDegrees: 360,
});

export interface Mission {
  schemaVersion: '1.0';
  metadata: { id: string; name: string; createdAt: string; updatedAt: string };
  scheduledAt: string;
  location: Coordinates;
  operationZone: OperationZone;
  priorityZones: PriorityZone[];
  weather: WeatherInfo;
  constraints: MissionConstraints;
  estimate: ResourceEstimate | null;
  availableResources: AvailableResources;
  pilots: Pilot[];
  drones: DroneInstance[];
  status: MissionStatus;
}
