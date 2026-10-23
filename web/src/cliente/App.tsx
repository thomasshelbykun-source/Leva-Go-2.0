import { NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { Icon, type IconName } from '../shared/brand';
import { Login, Register, ResetPassword } from '../shared/Auth';
import { RequireAuth, SessionProvider } from '../shared/session';
import { Navigate } from 'react-router-dom';
import { NewOrder } from './NewOrder';
import { Payment } from './Payment';
import { Home, Notifications, Orders, Plans, Profile, Support, Welcome } from './Screens';
import { Receipt, Track } from './Track';

const BASE = '/cliente';
const TABS: [string, IconName, string][] = [
  [BASE, 'home', 'Início'],
  [`${BASE}/encomendas`, 'list', 'Pedidos'],
  [`${BASE}/planos`, 'shield', 'Subscrição'],
  [`${BASE}/notificacoes`, 'bell', 'Notificações'],
  [`${BASE}/perfil`, 'user', 'Perfil'],
];

function Shell() {
  return (
    <div className="app-shell">
      <main>
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Navegação">
        {TABS.map(([to, icon, label]) => (
          <NavLink key={to} to={to} end={to === BASE}>
            <Icon name={icon} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default function ClienteApp() {
  return (
    <SessionProvider app="cliente" base={BASE}>
      <Routes>
        <Route path="boas-vindas" element={<Welcome />} />
        <Route path="entrar" element={<Login />} />
        <Route path="registo" element={<Register />} />
        <Route path="recuperar" element={<ResetPassword />} />
        <Route
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        >
          <Route index element={<Home />} />
          <Route path="nova" element={<NewOrder />} />
          <Route path="pagar/:id" element={<Payment kind="order" />} />
          <Route path="pagar-plano/:id" element={<Payment kind="subscription" />} />
          <Route path="encomendas" element={<Orders />} />
          <Route path="encomendas/:id" element={<Track />} />
          <Route path="encomendas/:id/comprovativo" element={<Receipt />} />
          <Route path="planos" element={<Plans />} />
          <Route path="notificacoes" element={<Notifications base={BASE} />} />
          <Route path="perfil" element={<Profile base={BASE} />} />
          <Route path="apoio" element={<Support base={BASE} />} />
        </Route>
        <Route path="*" element={<Navigate to={BASE} replace />} />
      </Routes>
    </SessionProvider>
  );
}
