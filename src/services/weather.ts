import type { WeatherInfo } from '../types/weather';

interface WeatherOptions { now?: number; fetcher?: typeof fetch; signal?: AbortSignal }

/** Open-Meteo adapter. Unknown/error is never converted into a dry forecast. */
export async function getWeather(latitude: number, longitude: number, dateTime: string, options: WeatherOptions = {}): Promise<WeatherInfo> {
  const unavailable: WeatherInfo = {
    status: 'unavailable', location: [longitude, latitude], dateTime,
    rainDetected: null, dayNight: 'unknown', source: null,
  };
  const target = Date.parse(dateTime);
  const now = options.now ?? Date.now();
  const day = Math.floor(now / 86400000) * 86400000;
  if (!Number.isFinite(target) || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || target < now || target >= day + 16 * 86400000) return unavailable;
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude),
      hourly: 'rain,showers', forecast_days: '16', timeformat: 'unixtime', timezone: 'GMT' }).toString();
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(7000)]) : AbortSignal.timeout(7000);
    const response = await (options.fetcher ?? fetch)(url, { signal });
    if (!response.ok) return unavailable;
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('hourly' in data)) return unavailable;
    const hourly = data.hourly;
    if (!hourly || typeof hourly !== 'object' || !('time' in hourly) || !('rain' in hourly) || !('showers' in hourly)
      || !Array.isArray(hourly.time) || !Array.isArray(hourly.rain) || !Array.isArray(hourly.showers)) return unavailable;
    // Precipitation is the sum over the preceding hour: choose interval enclosing the operation time.
    const hourEnd = Math.ceil(target / 3600000) * 3600;
    const index = hourly.time.findIndex(t => t === hourEnd);
    const rain: unknown = hourly.rain[index], showers: unknown = hourly.showers[index];
    if (index < 0 || typeof rain !== 'number' || typeof showers !== 'number'
      || !Number.isFinite(rain) || !Number.isFinite(showers) || rain < 0 || showers < 0) return unavailable;
    return { ...unavailable, status: 'available', rainDetected: rain + showers > 0, source: 'Open-Meteo' };
  } catch { return unavailable; }
}
