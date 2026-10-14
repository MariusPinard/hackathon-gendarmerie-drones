import type { AvailableResources, DroneInstance, DroneModel, Pilot, ResourceEstimate } from './drone';
import type { Coordinates, OperationZone, PriorityZone } from './geo';
import type { MissionConstraints } from './mission';
import type { WeatherInfo } from './weather';

export interface PlanningInput {
  missionId: string;
  location: Coordinates;
  scheduledAt: string;
  operationZone: OperationZone;
  priorityZones: PriorityZone[];
  weather: WeatherInfo;
  constraints: MissionConstraints;
  catalog: readonly DroneModel[];
  availableResources: AvailableResources;
  /** Mixed TP1/TP2 by default for new plans; old missions retain their scenario. */
  capabilityId?: string;
}

export type { ResourceEstimate } from './drone';

export interface CoverageMetrics {
  operationAreaSquareMeters: number;
  coveredAreaSquareMeters: number;
  priorityAreaSquareMeters: number;
  coveredPriorityAreaSquareMeters: number;
  overlapOutsidePrioritySquareMeters: number;
  totalCoveragePercent: number;
  priorityCoveragePercent: number | null;
  overlapPercent: number;
  usedDroneCount: number;
  sampleCount: number;
  sampleSpacingMeters: number;
  uncoveredPoints: Coordinates[];
}

export interface PlanningResult {
  missionId: string;
  estimate: ResourceEstimate;
  pilots: Pilot[];
  drones: DroneInstance[];
  operationZone: OperationZone;
  priorityZones: PriorityZone[];
  warnings: string[];
}
