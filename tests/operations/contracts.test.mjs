import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { detectConflicts, recalculateMission, triggerEmergencyLanding, triggerReturnToHome } from '../../src/engines/operations/index.ts';
import { EngineNotImplementedError } from '../../src/engines/notImplemented.ts';

test('unimplemented operations never mutate mission state or report simulation success', () => {
  const mission = JSON.parse(readFileSync(new URL('../../src/data/exampleMission.json', import.meta.url), 'utf8'));
  const original = structuredClone(mission);
  for (const engine of [detectConflicts, recalculateMission, triggerEmergencyLanding, triggerReturnToHome]) {
    assert.throws(() => engine(mission, { type: 'move_drone', droneId: 'drone-1', dronePosition: [0, 0] }), EngineNotImplementedError);
    assert.deepEqual(mission, original);
  }
});
