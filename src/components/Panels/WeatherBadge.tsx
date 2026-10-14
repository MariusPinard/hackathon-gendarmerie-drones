import type { WeatherInfo } from '../../types/weather';

export function WeatherBadge({ weather, loading = false }: { weather: WeatherInfo | null; loading?: boolean }) {
  const rain = weather?.status === 'available' && weather.rainDetected === true;
  const dry = weather?.status === 'available' && weather.rainDetected === false;
  const night = weather?.dayNight === 'night';
  const knownDayNight = weather?.dayNight === 'day' || night;
  return <span className={`weather-badge ${rain ? 'rain' : dry ? 'sun' : 'unknown'}`} title={dry ? 'Indication simplifiée : aucune pluie prévue, sans prévision de nébulosité.' : undefined}>
    <span aria-hidden="true">{loading ? '◌' : rain ? '☂' : dry ? night ? '☾' : '☀' : '☁'}</span>
    {loading ? 'Météo…' : rain ? 'Pluie prévue' : dry ? night ? 'Sans pluie' : 'Beau temps' : 'Météo indisponible'}
    {knownDayNight && <small className={`day-night-badge ${night ? 'night' : 'day'}`}><span aria-hidden="true">{night ? '☾' : '☀'}</span>{night ? 'Nuit' : 'Jour'}</small>}
  </span>;
}
