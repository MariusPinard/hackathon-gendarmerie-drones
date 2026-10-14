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
  /** Minimum coverage gain (points of %) for an extra drone; default MIN_GAIN_PER_DRONE. */
  minimumGainPerDronePercent?: number;
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
  /** Best coverage found for each number of drones; `chosen` marks the retained trade-off. */
  tradeoff?: { drones: number; coveragePercent: number; priorityCoveragePercent: number | null; chosen: boolean }[];
}
