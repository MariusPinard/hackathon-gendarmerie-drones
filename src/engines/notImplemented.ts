export class EngineNotImplementedError extends Error {
  constructor(operation: string) {
    super(`${operation}: moteur à implémenter après validation des contrats.`);
    this.name = 'EngineNotImplementedError';
  }
}
