import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DRONE_CATALOG } from '../src/data/droneCatalog.ts';
import { estimateResources, generatePlan, computeCoverage } from '../src/engines/planning/index.ts';
import { startMission, recalculateMission, triggerReturnToHome, triggerEmergencyLanding, advanceSimulation, detectConflicts } from '../src/engines/operations/index.ts';
import { serializeMission, parseMission } from '../src/services/missionStorage.ts';
import { applyPlan, missionPlanningInput } from '../src/services/missionPlanning.ts';

test('complete saved/imported workflow: estimate, scarce resources, launch, sector, loss, return and emergency', () => {
  const source = JSON.parse(readFileSync(new URL('../src/data/exampleMission.json', import.meta.url)));
  source.operationZone.geometry.coordinates = [[[-1.7, 48.10], [-1.64, 48.10], [-1.64, 48.14], [-1.7, 48.14], [-1.7, 48.10]]];
  source.estimate = estimateResources(missionPlanningInput(source));
  source.availableResources.dronesByModel = { ...source.estimate.dronesByModel };
  source.availableResources.dronesByModel['dji-mini-5'] = 0;
  const plan = generatePlan(missionPlanningInput(source));
  const prepared = parseMission(serializeMission(applyPlan(source, plan)));
  assert.deepEqual(prepared.estimate, source.estimate);
  assert.ok(prepared.drones.every(d => d.modelId !== 'dji-mini-5'));
  assert.ok(computeCoverage(plan).totalCoveragePercent > 0);
  let active = startMission(prepared).mission;
  const original = structuredClone(active);
  active = recalculateMission(active, { type: 'set_coverage', droneId: active.drones[0].id, headingDegrees: 90, workingAngleDegrees: 60 }).mission;
  active = recalculateMission(active, { type: 'set_availability', droneId: active.drones[0].id, status: 'unavailable' }).mission;
  assert.deepEqual(active.drones.slice(1), original.drones.slice(1));
  active = parseMission(serializeMission(active));
  const completed = advanceSimulation(triggerReturnToHome(active).mission, 1).mission;
  assert.equal(completed.status, 'completed');
  for (const d of completed.drones.filter(d => d.status === 'completed')) assert.deepEqual(d.dronePosition, completed.pilots.find(p => p.id === d.pilotId).pilotPosition);
  const emergency = advanceSimulation(triggerEmergencyLanding(original).mission, 1).mission;
  assert.equal(emergency.status, 'emergency'); assert.ok(emergency.drones.every(d => d.status === 'completed' && d.altitudeMetersAgl === 0));
  parseMission(serializeMission(completed)); parseMission(serializeMission(emergency));
});

test('infeasible altitude assignment is explicit and prevents launching the configuration', () => {
  const source = JSON.parse(readFileSync(new URL('../src/data/exampleMission.json', import.meta.url)));
  source.operationZone.geometry.coordinates = [[[-1.7, 48.10], [-1.64, 48.10], [-1.64, 48.14], [-1.7, 48.14], [-1.7, 48.10]]];
  const input = { ...missionPlanningInput(source), catalog: DRONE_CATALOG, constraints: { ...source.constraints, minimumVerticalSeparationMeters: 1000 },
    availableResources: { dronesByModel: { 'dji-matrice-4t': 8, 'dji-mavic-3-enterprise': 8, 'dji-mini-5': 8 } } };
  const plan = generatePlan(input);
  assert.ok(plan.warnings.some(w => w.includes('aucune altitude')));
  const mission = applyPlan({ ...source, constraints: input.constraints, availableResources: input.availableResources }, plan);
  assert.ok(detectConflicts(mission).some(c => c.type === 'vertical_separation'));
  assert.throws(() => startMission(mission), /conflits/);
});

test('requested TP1 in-sight 500m scenario survives planning, file round-trip and launch under its 120m ceiling', () => {
  const source = JSON.parse(readFileSync(new URL('../src/data/exampleMission.json', import.meta.url)));
  source.constraints = { ...source.constraints, capabilityId: 'tp1-in-sight', minimumVerticalSeparationMeters: 30 };
  source.estimate = estimateResources(missionPlanningInput(source));
  source.availableResources.dronesByModel = { ...source.estimate.dronesByModel };
  const proposed = generatePlan(missionPlanningInput(source));
  assert.ok(proposed.drones.length > 0);
  assert.ok(proposed.drones.every(drone => drone.coverage.radiusMeters === 500 && drone.altitudeMetersAgl <= 120));
  const prepared = parseMission(serializeMission(applyPlan(source, proposed))), active = startMission(prepared).mission;
  assert.ok(active.drones.every(drone => drone.status === 'active' && drone.capabilityId === 'tp1-in-sight'));
  const raised = recalculateMission(active, { type: 'set_altitude', droneId: active.drones[0].id, altitudeMetersAgl: 120 });
  assert.equal(raised.mission.drones[0].altitudeMetersAgl, 120);
  assert.throws(() => recalculateMission(active, { type: 'set_altitude', droneId: active.drones[0].id, altitudeMetersAgl: 121 }), /120/);
  const legacy = structuredClone(prepared);
  legacy.droneCatalog = DRONE_CATALOG.map(model => ({ ...model, capabilities: model.capabilities.map(capability =>
    capability.id === 'tp1-in-sight' ? { ...capability, rangeMeters: null } : capability) }));
  const importedLegacy = parseMission(serializeMission(legacy));
  assert.throws(() => generatePlan(missionPlanningInput(importedLegacy)), /portée/);
});
