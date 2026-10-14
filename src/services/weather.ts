import type { WeatherInfo } from '../types/weather';

/** Provider-independent boundary. No forecast or astronomical calculation yet. */
export async function getWeather(latitude: number, longitude: number, dateTime: string): Promise<WeatherInfo> {
  // TODO(weather): choose a provider and adapt its native fetch() response here.
  return {
    status: 'unavailable', location: [longitude, latitude], dateTime,
    rainDetected: null, dayNight: 'unknown', source: null,
  };
}
