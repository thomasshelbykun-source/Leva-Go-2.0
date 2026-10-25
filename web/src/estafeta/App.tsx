import { Link, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { PushCard } from '../shared/Alerts';
import { Icon, type IconName } from '../shared/brand';
import { Notifications, Profile, Support } from '../cliente/Screens';
import { Login, Register, ResetPassword } from '../shared/Auth';
import { RequireAuth, SessionProvider } from '../shared/session';
import { Apply, CourierHome, CourierWelcome, Earnings, History, Task, Vehicle } from './Screens';

const BASE = '/estafeta';
const TABS: [string, IconName, string][] = [
  [BASE, 'home', 'Início'],
  [`${BASE}/ganhos`, 'wallet', 'Ganhos'],
  [`${BASE}/veiculo`, 'scooter', 'Veículo'],
  [`${BASE}/notificacoes`, 'bell', 'Avisos'],
  [`${BASE}/perfil`, 'user', 'Perfil'],
];

function Shell() {
  return (
    <div className="app-shell courier">
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

function CourierProfile() {
  return (
    <>
      <div className="page stack">
        <PushCard />
        <Link className="btn btn-secondary" to={`${BASE}/veiculo`}>
          O meu veículo
        </Link>
      </div>
      <Profile base={BASE} />
    </>
  );
}

export default function EstafetaApp() {
  return (
    <SessionProvider app="estafeta" base={BASE}>
      <Routes>
        <Route path="boas-vindas" element={<CourierWelcome />} />
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
          <Route index element={<CourierHome />} />
          <Route path="candidatura" element={<Apply />} />
          <Route path="tarefa/:id" element={<Task />} />
          <Route path="historico" element={<History />} />
          <Route path="ganhos" element={<Earnings />} />
          <Route path="veiculo" element={<Vehicle />} />
          <Route path="notificacoes" element={<Notifications base={BASE} />} />
          <Route path="perfil" element={<CourierProfile />} />
          <Route path="apoio" element={<Support base={BASE} />} />
        </Route>
        <Route path="*" element={<Navigate to={BASE} replace />} />
      </Routes>
    </SessionProvider>
  );
}
