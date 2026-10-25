import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Avatar, Icon, Logo, type IconName } from '../shared/brand';
import { Login, ResetPassword } from '../shared/Auth';
import { RequireAuth, SessionProvider, useSession } from '../shared/session';
import { Pricing, Payments, Reports, Settings, Subscriptions, TicketDetail, Tickets, Zones } from './Business';
import { AdminOrderDetail, AdminOrders, CourierDetail, Couriers, CustomerDetail, Customers, Dashboard } from './Operations';

const BASE = '/admin';
const MENU: [string, IconName, string][] = [
  ['', 'dashboard', 'Dashboard'], ['clientes', 'users', 'Clientes'], ['estafetas', 'scooter', 'Estafetas'], ['encomendas', 'box', 'Encomendas'],
  ['subscricoes', 'shield', 'Subscrições'], ['pagamentos', 'card', 'Pagamentos'], ['tarifas', 'tag', 'Tarifas'], ['zonas', 'map', 'Zonas e cobertura'],
  ['suporte', 'chat', 'Reclamações'], ['relatorios', 'chart', 'Relatórios'], ['definicoes', 'gear', 'Configurações'],
];

// No telemóvel, estas secções ficam na barra de baixo. As outras estão no menu.
const QUICK: [string, IconName, string][] = [
  ['', 'dashboard', 'Dashboard'], ['encomendas', 'box', 'Encomendas'], ['estafetas', 'scooter', 'Estafetas'], ['clientes', 'users', 'Clientes'],
];

function Shell() {
  const s = useSession();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const role = s.me?.roles.includes('super_admin') ? 'Super administrador' : 'Administrador';
  // Fecha o menu ao mudar de página.
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className={`admin-shell ${open ? 'menu-open' : ''}`}>
      {open && <div className="admin-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside id="admin-menu">
        <div className="aside-head">
          <Logo size={26} light />
          <button className="icon-btn aside-close" aria-label="Fechar menu" onClick={() => setOpen(false)}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <nav>
          {MENU.map(([p, icon, l]) => (
            <NavLink key={p} to={`${BASE}/${p}`} end={p === ''}>
              <Icon name={icon} size={19} />
              {l}
            </NavLink>
          ))}
        </nav>
        <button className="aside-out" onClick={() => s.signOut()}>
          <Icon name="logout" size={19} /> Sair
        </button>
      </aside>
      <div className="admin-main">
        <header className="admin-top">
          <button className="icon-btn admin-burger" aria-label="Abrir menu" aria-controls="admin-menu" aria-expanded={open} onClick={() => setOpen(true)}>
            <Icon name="menu" />
          </button>
          <span className="admin-top-title">Painel administrativo</span>
          <div className="admin-user">
            <Avatar name={s.me?.name} />
            <div>
              <strong>{s.me?.name}</strong>
              <small>{role}</small>
            </div>
          </div>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
      <nav className="bottom-nav admin-bottom" aria-label="Navegação rápida">
        {QUICK.map(([p, icon, l]) => (
          <NavLink key={p} to={`${BASE}/${p}`} end={p === ''}>
            <Icon name={icon} />
            {l}
          </NavLink>
        ))}
        <button type="button" onClick={() => setOpen(true)}>
          <Icon name="menu" />
          Mais
        </button>
      </nav>
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
