import type { Coordinates } from './geo';

export type DayNightStatus = 'day' | 'night' | 'unknown';

export interface WeatherInfo {
  status: 'available' | 'unavailable';
  location: Coordinates;
  /** ISO 8601 with UTC or explicit offset. */
  dateTime: string;
  rainDetected: boolean | null;
  dayNight: DayNightStatus;
  source: string | null;
}
