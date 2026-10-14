import { DRONE_CATALOG } from '../data/droneCatalog.ts';
import type { Mission } from '../types/mission';
import type { PlanningInput, PlanningResult } from '../types/planning';

export function missionPlanningInput(mission: Mission): PlanningInput {
  return { missionId: mission.metadata.id, location: mission.location, scheduledAt: mission.scheduledAt,
    operationZone: mission.operationZone, priorityZones: mission.priorityZones, weather: mission.weather,
    constraints: mission.constraints, availableResources: mission.availableResources, catalog: mission.droneCatalog ?? DRONE_CATALOG,
    capabilityId: mission.constraints.capabilityId ?? mission.drones[0]?.capabilityId ?? 'tp1-out-of-sight' };
}

export function applyPlan(mission: Mission, plan: PlanningResult): Mission {
  return { ...mission, metadata: { ...mission.metadata, updatedAt: new Date().toISOString() },
    estimate: mission.estimate ?? plan.estimate, pilots: plan.pilots, drones: plan.drones, status: 'ready' };
}
