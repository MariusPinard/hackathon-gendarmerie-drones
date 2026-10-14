import type { Mission } from '../../types/mission';
import type { Conflict, MissionChange, OperationsResult } from '../../types/operations';
import { EngineNotImplementedError } from '../notImplemented.ts';

// TODO(operations): implement pure simulation and conflict detection; no drone I/O.
export function detectConflicts(_mission: Mission): Conflict[] {
  throw new EngineNotImplementedError('detectConflicts');
}

export function recalculateMission(_mission: Mission, _change: MissionChange): OperationsResult {
  throw new EngineNotImplementedError('recalculateMission');
}

export function triggerEmergencyLanding(_mission: Mission): OperationsResult {
  throw new EngineNotImplementedError('triggerEmergencyLanding');
}

export function triggerReturnToHome(_mission: Mission): OperationsResult {
  throw new EngineNotImplementedError('triggerReturnToHome');
}
