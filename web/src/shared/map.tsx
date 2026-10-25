import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

// Centro de Quelimane.
export const QUELIMANE: [number, number] = [-17.8786, 36.8883];
const TILE_URL = (import.meta.env.VITE_TILE_URL as string | undefined) ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const SCOOTER =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M8.5 17h7l2-7h-4M13 7h3l2 3M4 13h6l2 4"/></svg>';

const dot = (cls: string, inner = '') =>
  L.divIcon({ className: 'pin', html: `<span class="pin-dot ${cls}">${inner}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });

export const PIN = {
  pickup: dot('pin-a', 'A'),
  dropoff: dot('pin-b', 'B'),
  courier: dot('pin-courier', SCOOTER),
  area: dot('pin-area'),
  me: dot('pin-me'),
};

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
    // Sem botões de zoom: nos telemóveis usa-se o gesto de pinça.
    const m = L.map(ref.current, { zoomControl: false, attributionControl: true }).setView(QUELIMANE, 13);
    m.attributionControl.setPrefix(false);
    L.tileLayer(TILE_URL, { maxZoom: 19, detectRetina: true, attribution: '© OpenStreetMap' }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => click.current?.(e.latlng.lat, e.latlng.lng));
    map.current = m;
    return () => {
      // Parar as animações antes de remover evita o erro '_leaflet_pos' ao mudar de ecrã.
      m.stop();
      m.off();
      m.remove();
      map.current = null;
    };
  }, [ref]);
  return map;
}

/** Mapa com marcadores, rota (GeoJSON LineString) e zonas. `padBottom` deixa espaço para o painel que cobre a parte de baixo. */
export function MapView({
  markers = [], route, polygons = [], height = 260, onClick, padBottom = 0, className = '',
}: {
  markers?: MapMarker[];
  route?: { type: string; coordinates: [number, number][] } | null;
  polygons?: { polygon: [number, number][]; kind: string; name?: string }[];
  height?: number | string;
  onClick?: (lat: number, lon: number) => void;
  padBottom?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useMap(ref, onClick);
  const layer = useRef<L.LayerGroup | null>(null);
  const key = JSON.stringify([markers, route, polygons, padBottom]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    m.invalidateSize();
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
      L.polyline(pts, { color: '#ffffff', weight: 9, opacity: 0.9, lineCap: 'round' }).addTo(g);
      L.polyline(pts, { color: '#0d2a4f', weight: 5, lineCap: 'round' }).addTo(g);
      bounds.push(...pts);
    }
    for (const mk of markers) {
      L.marker([mk.lat, mk.lon], { icon: PIN[mk.kind], title: mk.title }).addTo(g);
      bounds.push([mk.lat, mk.lon]);
    }
    const pad = { paddingTopLeft: [30, 30] as [number, number], paddingBottomRight: [30, 30 + padBottom] as [number, number] };
    if (bounds.length > 1) m.fitBounds(L.latLngBounds(bounds), { ...pad, maxZoom: 16, animate: false });
    else if (bounds.length === 1) {
      m.setView(bounds[0]!, 15, { animate: false });
      if (padBottom) m.panBy([0, padBottom / 2], { animate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <div ref={ref} className={`map ${className}`} style={{ height }} />;
}
