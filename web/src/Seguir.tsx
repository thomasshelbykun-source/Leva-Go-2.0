import { useParams } from 'react-router-dom';
import { api } from './shared/api';
import { Logo, LogoMark } from './shared/brand';
import { HEADLINE, minutes } from './shared/format';
import { MapView, type MapMarker } from './shared/map';
import { Empty, OrderProgress, Sheet, useLoad } from './shared/ui';

/** Seguimento público: abre pelo link partilhado, sem iniciar sessão. Mostra só o estado e a posição do estafeta. */
export default function Seguir() {
  const { token } = useParams();
  const q = useLoad(() => api('cliente').get<any>(`/public/track/${token}`), [token], 15_000);

  if (q.error && !q.data) {
    return (
      <div className="page">
        <Logo size={32} />
        <Empty icon="clock" title={q.error.status === 410 ? 'Este link já expirou' : 'Link não encontrado'} text="Peça a quem lhe enviou o link para o partilhar de novo." />
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="page">
        <Logo size={32} />
        <div className="skeleton" style={{ height: 220, borderRadius: 16 }} />
      </div>
    );
  }
  const o = q.data;
  const markers: MapMarker[] = [];
  if (o.dropoff) markers.push({ lat: o.dropoff.lat, lon: o.dropoff.lon, kind: 'dropoff' });
  if (o.courier_location) markers.push({ lat: o.courier_location.lat, lon: o.courier_location.lon, kind: 'courier', title: 'Estafeta' });
  return (
    <div className="map-screen">
      <MapView height="58vh" markers={markers} padBottom={120} />
      <div className="map-top">
        <span className="round-btn" aria-hidden="true">
          <LogoMark size={28} />
        </span>
        <span className="badge badge-muted">{o.code}</span>
      </div>
      <Sheet>
        <div className="row-between">
          <h2 className="headline">{HEADLINE[o.status] ?? o.status_label}</h2>
          {o.courier_location && o.estimated_duration_s && (
            <div className="eta">
              <strong>{minutes(o.estimated_duration_s)}</strong>
              <small>de viagem</small>
            </div>
          )}
        </div>
        <OrderProgress status={o.status} />
        {o.courier && (
          <div className="driver">
            <span className="avatar">{String(o.courier.name).slice(0, 1).toUpperCase()}</span>
            <span className="txt">
              <strong>{o.courier.name}</strong>
              <small>{o.courier.vehicle === 'motorizada' ? 'Motorizada' : o.courier.vehicle === 'bicicleta' ? 'Bicicleta' : 'Estafeta LevaGo'}</small>
            </span>
          </div>
        )}
        <small className="sub">Esta página actualiza sozinha. Por segurança, não mostra moradas de recolha, telefones nem preços.</small>
      </Sheet>
    </div>
  );
}
