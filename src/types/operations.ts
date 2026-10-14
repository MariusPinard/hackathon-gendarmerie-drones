import type { Coordinates } from './geo';
import type { DroneStatus } from './drone';
import type { Mission } from './mission';
import type { CoverageMetrics } from './planning';

export interface Conflict {
  id: string;
  type: 'vertical_separation' | 'rain_incompatibility' | 'capability_limit' | 'resource_shortage';
  droneIds: string[];
  message: string;
  approximatePosition?: Coordinates;
  altitudeDifferenceMeters?: number;
}

export type MissionChange =
  | { type: 'move_drone'; droneId: string; dronePosition: Coordinates }
  | { type: 'move_pilot'; pilotId: string; pilotPosition: Coordinates }
  | { type: 'set_altitude'; droneId: string; altitudeMetersAgl: number }
  | { type: 'set_coverage'; droneId: string; headingDegrees: number; workingAngleDegrees: number }
  | { type: 'set_availability'; droneId: string; status: Extract<DroneStatus, 'active' | 'reserve' | 'unavailable'> };

export interface OperationsResult {
  mission: Mission;
  coverage: CoverageMetrics;
  conflicts: Conflict[];
  warnings: string[];
}
