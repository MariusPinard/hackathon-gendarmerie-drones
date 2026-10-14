import type { WeatherInfo } from '../../types/weather';

export function WeatherBadge({ weather, loading = false }: { weather: WeatherInfo | null; loading?: boolean }) {
  const rain = weather?.status === 'available' && weather.rainDetected === true;
  const dry = weather?.status === 'available' && weather.rainDetected === false;
  return <span className={`weather-badge ${rain ? 'rain' : dry ? 'sun' : 'unknown'}`} title={dry ? 'Indication simplifiée : aucune pluie prévue, sans prévision de nébulosité.' : undefined}>
    <span aria-hidden="true">{loading ? '◌' : rain ? '☂' : dry ? '☀' : '☁'}</span>
    {loading ? 'Météo…' : rain ? 'Pluie prévue' : dry ? 'Beau temps' : 'Météo indisponible'}
  </span>;
}
