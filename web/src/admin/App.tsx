import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Login, ResetPassword } from '../shared/Auth';
import { RequireAuth, SessionProvider, useSession } from '../shared/session';
import { Pricing, Payments, Reports, Settings, Subscriptions, TicketDetail, Tickets, Zones } from './Business';
import { AdminOrderDetail, AdminOrders, CourierDetail, Couriers, CustomerDetail, Customers, Dashboard } from './Operations';

const BASE = '/admin';
const MENU: [string, string][] = [
  ['', 'Painel'], ['encomendas', 'Encomendas'], ['clientes', 'Clientes'], ['estafetas', 'Estafetas'], ['subscricoes', 'Subscrições'], ['pagamentos', 'Pagamentos'],
  ['tarifas', 'Tarifas'], ['zonas', 'Zonas'], ['suporte', 'Apoio'], ['relatorios', 'Relatórios'], ['definicoes', 'Definições'],
];

function Shell() {
  const s = useSession();
  return (
    <div className="admin-shell">
      <aside>
        <div className="brand small-brand">
          <img src="/icon.svg" alt="" width={32} height={32} />
          <strong>LevaGo Admin</strong>
        </div>
        <nav>
          {MENU.map(([p, l]) => (
            <NavLink key={p} to={`${BASE}/${p}`} end={p === ''}>
              {l}
            </NavLink>
          ))}
        </nav>
        <div className="aside-foot">
          <small>{s.me?.name}</small>
          <button className="link" onClick={() => s.signOut()}>
            Sair
          </button>
        </div>
      </aside>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

export default function AdminApp() {
  return (
    <SessionProvider app="admin" base={BASE}>
      <Routes>
        <Route path="entrar" element={<Login />} />
        <Route path="recuperar" element={<ResetPassword />} />
        <Route
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="encomendas" element={<AdminOrders />} />
          <Route path="encomendas/:id" element={<AdminOrderDetail />} />
          <Route path="clientes" element={<Customers />} />
          <Route path="clientes/:id" element={<CustomerDetail />} />
          <Route path="estafetas" element={<Couriers />} />
          <Route path="estafetas/:id" element={<CourierDetail />} />
          <Route path="subscricoes" element={<Subscriptions />} />
          <Route path="pagamentos" element={<Payments />} />
          <Route path="tarifas" element={<Pricing />} />
          <Route path="zonas" element={<Zones />} />
          <Route path="suporte" element={<Tickets />} />
          <Route path="suporte/:id" element={<TicketDetail />} />
          <Route path="relatorios" element={<Reports />} />
          <Route path="definicoes" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to={BASE} replace />} />
      </Routes>
    </SessionProvider>
  );
}
