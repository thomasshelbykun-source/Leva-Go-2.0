import { Link, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { Notifications, Profile, Support } from '../cliente/Screens';
import { Login, Register, ResetPassword } from '../shared/Auth';
import { RequireAuth, SessionProvider } from '../shared/session';
import { Apply, CourierHome, CourierWelcome, Earnings, History, Task, Vehicle } from './Screens';

const BASE = '/estafeta';

function Shell() {
  return (
    <div className="app-shell courier">
      <main>
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Navegação">
        <NavLink to={BASE} end>
          <span>🛵</span>Pedidos
        </NavLink>
        <NavLink to={`${BASE}/historico`}>
          <span>📋</span>Histórico
        </NavLink>
        <NavLink to={`${BASE}/ganhos`}>
          <span>💰</span>Ganhos
        </NavLink>
        <NavLink to={`${BASE}/notificacoes`}>
          <span>🔔</span>Avisos
        </NavLink>
        <NavLink to={`${BASE}/perfil`}>
          <span>👤</span>Perfil
        </NavLink>
      </nav>
    </div>
  );
}

function CourierProfile() {
  return (
    <>
      <div className="page">
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
