import type { CoverageMetrics, PlanningInput, PlanningResult, ResourceEstimate } from '../../types/planning';
import { EngineNotImplementedError } from '../notImplemented.ts';

// TODO(planning): implement estimation and geometry using these shared contracts.
export function estimateResources(_input: PlanningInput): ResourceEstimate {
  throw new EngineNotImplementedError('estimateResources');
}

export function generatePlan(_input: PlanningInput): PlanningResult {
  throw new EngineNotImplementedError('generatePlan');
}

export function computeCoverage(_plan: PlanningResult): CoverageMetrics {
  throw new EngineNotImplementedError('computeCoverage');
}
