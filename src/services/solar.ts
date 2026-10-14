import type { DayNightStatus } from '../types/weather';

const radians = Math.PI / 180;
const degrees = 180 / Math.PI;
const wrap = (value: number, period: number) => ((value % period) + period) % period;

/** ISO instant with an explicit offset; reject calendar dates Date.parse would normalise. */
export function parseSolarInstant(dateTime: string): number | null {
  const parts = /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$/.exec(dateTime);
  if (!parts) return null;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const hour = Number(parts[4]), minute = Number(parts[5]), second = Number(parts[6] ?? 0);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (monthDays[month - 1] ?? 0)
    || hour > 24 || minute > 59 || second > 59
    || (hour === 24 && (minute !== 0 || second !== 0 || Number(parts[7] ?? 0) !== 0))) return null;
  const instant = Date.parse(dateTime);
  return Number.isFinite(instant) ? instant : null;
}

/**
 * Geometric elevation of the solar-disc centre, without atmospheric refraction.
 * NOAA/Meeus Julian-century equations: https://gml.noaa.gov/grad/solcalc/calcdetails.html
 * Formula reference: https://gml.noaa.gov/grad/solcalc/main.js
 * UTC and longitude east-positive avoid dependence on the browser time zone.
 */
export function solarElevationDegrees(latitude: number, longitude: number, dateTime: string): number | null {
  const instant = parseSolarInstant(dateTime);
  if (instant === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const century = (instant / 86400000 + 2440587.5 - 2451545) / 36525;
  const meanLongitude = wrap(280.46646 + century * (36000.76983 + 0.0003032 * century), 360) * radians;
  const anomaly = wrap(357.52911 + century * (35999.05029 - 0.0001537 * century), 360) * radians;
  const eccentricity = 0.016708634 - century * (0.000042037 + 0.0000001267 * century);
  const centre = Math.sin(anomaly) * (1.914602 - century * (0.004817 + 0.000014 * century))
    + Math.sin(2 * anomaly) * (0.019993 - 0.000101 * century) + Math.sin(3 * anomaly) * 0.000289;
  const omega = (125.04 - 1934.136 * century) * radians;
  const apparentLongitude = meanLongitude + (centre - 0.00569 - 0.00478 * Math.sin(omega)) * radians;
  const obliquitySeconds = 21.448 - century * (46.815 + century * (0.00059 - century * 0.001813));
  const obliquity = (23 + (26 + obliquitySeconds / 60) / 60 + 0.00256 * Math.cos(omega)) * radians;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(apparentLongitude));
  const tangent = Math.tan(obliquity / 2) ** 2;
  const equationMinutes = 4 * degrees * (tangent * Math.sin(2 * meanLongitude) - 2 * eccentricity * Math.sin(anomaly)
    + 4 * eccentricity * tangent * Math.sin(anomaly) * Math.cos(2 * meanLongitude)
    - 0.5 * tangent ** 2 * Math.sin(4 * meanLongitude) - 1.25 * eccentricity ** 2 * Math.sin(2 * anomaly));
  const utcMinutes = wrap(instant, 86400000) / 60000;
  const hourAngle = (wrap(utcMinutes + equationMinutes + 4 * longitude, 1440) / 4 - 180) * radians;
  const latitudeRadians = latitude * radians;
  const sineElevation = Math.sin(latitudeRadians) * Math.sin(declination)
    + Math.cos(latitudeRadians) * Math.cos(declination) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sineElevation))) * degrees;
}

/** Civil twilight threshold (SERA Article 2(97)); independent of the rain forecast. */
export function getDayNight(latitude: number, longitude: number, dateTime: string): DayNightStatus {
  const elevation = solarElevationDegrees(latitude, longitude, dateTime);
  return elevation === null ? 'unknown' : elevation <= -6 ? 'night' : 'day';
}
