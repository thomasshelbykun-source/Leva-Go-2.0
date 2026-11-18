import { lazy, Suspense } from 'react';
import { IN_APP } from './inapp';

// O mapa (Leaflet, cerca de 170 kB) só é descarregado quando um ecrã mostra um mapa.
// Assim a página inicial, o Entrar e o Início abrem mais depressa.
const LeafletMap = lazy(() => import('./map-leaflet'));

// Centro de Quelimane (piloto).
export const QUELIMANE: [number, number] = [-17.8786, 36.8883];

export interface MapMarker {
  lat: number;
  lon: number;
  kind: 'pickup' | 'dropoff' | 'courier' | 'area';
  title?: string;
}

/** Mapa só de leitura: marcadores, rota (GeoJSON LineString) e zonas. */
export function MapView({
  markers = [], route, polygons = [], height = 260, onClick,
}: {
  markers?: MapMarker[];
  route?: { type: string; coordinates: [number, number][] } | null;
  polygons?: { polygon: [number, number][]; kind: string; name?: string }[];
  height?: number;
  onClick?: (lat: number, lon: number) => void;
}) {
  if (IN_APP) return null;
  return (
    <Suspense fallback={<div className="map" style={{ height }} aria-hidden="true" />}>
      <LeafletMap markers={markers} route={route} polygons={polygons} height={height} onClick={onClick} />
    </Suspense>
  );
}
