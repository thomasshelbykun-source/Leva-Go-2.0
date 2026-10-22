import { NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { Login, Register, ResetPassword } from '../shared/Auth';
import { RequireAuth, SessionProvider } from '../shared/session';
import { Navigate } from 'react-router-dom';
import { NewOrder } from './NewOrder';
import { Payment } from './Payment';
import { Home, Notifications, Orders, Plans, Profile, Support, Welcome } from './Screens';
import { Receipt, Track } from './Track';

const BASE = '/cliente';

function Shell() {
  return (
    <div className="app-shell">
      <main>
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Navegação">
        <NavLink to={BASE} end>
          <span>🏠</span>Início
        </NavLink>
        <NavLink to={`${BASE}/nova`}>
          <span>➕</span>Enviar
        </NavLink>
        <NavLink to={`${BASE}/encomendas`}>
          <span>📦</span>Encomendas
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
