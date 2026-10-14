import { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Coordinates } from '../../types/geo';

export function PlanningMap({ center }: { center: Coordinates }) {
  const container = useRef<HTMLDivElement>(null);
  const [longitude, latitude] = center;

  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current).setView([latitude, longitude], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    return () => { map.remove(); };
  }, [latitude, longitude]);

  return <div ref={container} className="planning-map" role="region" aria-label="Carte de planification" />;
}
