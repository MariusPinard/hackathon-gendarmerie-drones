import type { MissionConstraints } from '../../types/mission';

/** User-entered simulation limits; this does not validate an administrative authorization. */
export function inspectAuthorization(constraints: MissionConstraints, scheduledAt: string): {
  maximumDrones: number; outsideWindow: boolean;
} {
  const authorization = constraints.authorization;
  if (!authorization) return { maximumDrones: Infinity, outsideWindow: false };
  if (typeof authorization.reference !== 'string' || !authorization.reference.trim() || authorization.reference.length > 200
    || !Number.isSafeInteger(authorization.maximumDrones) || authorization.maximumDrones < 0)
    throw new Error('Autorisation : référence et effectif entier positif ou nul attendus.');
  const instant = (value: string) => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
  const start = instant(authorization.startAt), end = instant(authorization.endAt), scheduled = instant(scheduledAt);
  if (![start, end, scheduled].every(Number.isFinite) || end < start) throw new Error('Autorisation : période horodatée invalide.');
  return { maximumDrones: authorization.maximumDrones, outsideWindow: scheduled < start || scheduled > end };
}
