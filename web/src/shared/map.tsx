import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

// Centro de Quelimane (piloto).
export const QUELIMANE: [number, number] = [-17.8786, 36.8883];
const TILE_URL = (import.meta.env.VITE_TILE_URL as string | undefined) ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const pin = (color: string, label = '') =>
  L.divIcon({
    className: 'pin',
    html: `<span style="background:${color}">${label}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  });
export const PIN = { pickup: pin('#102B50', 'A'), dropoff: pin('#FF8C00', 'B'), courier: pin('#16a34a', '🛵'), area: pin('#64748b', '~') };

export interface MapMarker {
  lat: number;
  lon: number;
  kind: keyof typeof PIN;
  title?: string;
}

function useMap(ref: React.RefObject<HTMLDivElement>, onClick?: (lat: number, lon: number) => void) {
  const map = useRef<L.Map | null>(null);
  const click = useRef(onClick);
  click.current = onClick;
  useEffect(() => {
    if (!ref.current || map.current) return;
    const m = L.map(ref.current, { zoomControl: true, attributionControl: true }).setView(QUELIMANE, 13);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => click.current?.(e.latlng.lat, e.latlng.lng));
    map.current = m;
    return () => {
      // Parar animações antes de remover evita o erro '_leaflet_pos' ao mudar de ecrã.
      m.stop();
      m.off();
      m.remove();
      map.current = null;
    };
  }, [ref]);
  return map;
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
  const ref = useRef<HTMLDivElement>(null);
  const map = useMap(ref, onClick);
  const layer = useRef<L.LayerGroup | null>(null);
  const key = JSON.stringify([markers, route, polygons]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    layer.current?.remove();
    const g = L.layerGroup().addTo(m);
    layer.current = g;
    const bounds: L.LatLngExpression[] = [];
    for (const z of polygons) {
      const pts = z.polygon.map(([lon, lat]) => [lat, lon] as [number, number]);
      L.polygon(pts, { color: z.kind === 'restricted' ? '#dc2626' : '#102B50', weight: 2, fillOpacity: 0.08 })
        .bindTooltip(z.name ?? '')
        .addTo(g);
      bounds.push(...pts);
    }
    if (route?.coordinates?.length) {
      const pts = route.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
      L.polyline(pts, { color: '#FF8C00', weight: 5 }).addTo(g);
      bounds.push(...pts);
    }
    for (const mk of markers) {
      L.marker([mk.lat, mk.lon], { icon: PIN[mk.kind], title: mk.title }).addTo(g);
      bounds.push([mk.lat, mk.lon]);
    }
    if (bounds.length > 1) m.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 16, animate: false });
    else if (bounds.length === 1) m.setView(bounds[0]!, 15, { animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <div ref={ref} className="map" style={{ height }} />;
}
