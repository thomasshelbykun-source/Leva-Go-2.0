import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { Icon, Logo } from './shared/brand';
import { Loading } from './shared/ui';
import './styles.css';

// Cada área carrega à parte, para o cliente não descarregar o código do Admin.
const ClienteApp = lazy(() => import('./cliente/App'));
const EstafetaApp = lazy(() => import('./estafeta/App'));
const AdminApp = lazy(() => import('./admin/App'));
const Seguir = lazy(() => import('./Seguir'));

function Legal({ kind }: { kind: 'termos' | 'privacidade' }) {
  return (
    <div className="page">
      <header className="page-head">
        <button className="icon-btn" aria-label="Voltar" onClick={() => history.back()}>
          <Icon name="back" />
        </button>
        <h1>{kind === 'termos' ? 'Termos de utilização' : 'Política de privacidade'}</h1>
      </header>
      <div className="card stack">
        <p>
          <strong>Texto jurídico pendente.</strong> A especificação (secção 14) indica que os termos e a política de privacidade ainda têm de ser
          redigidos e aprovados pela LevaGo antes do lançamento público.
        </p>
        {kind === 'privacidade' && (
          <ul>
            <li>Recolhemos nome, telemóvel, moradas de recolha e entrega, e dados das encomendas.</li>
            <li>A localização do estafeta só é partilhada durante uma entrega activa.</li>
            <li>Nunca guardamos o PIN da carteira móvel.</li>
            <li>Pode pedir a eliminação da conta em Perfil.</li>
          </ul>
        )}
      </div>
    </div>
  );
}

const AREAS = [
  { to: '/cliente', icon: 'box', title: 'Cliente', text: 'Envie encomendas, veja o preço e acompanhe no mapa.', cta: 'Enviar uma encomenda' },
  { to: '/estafeta', icon: 'scooter', title: 'Estafeta', text: 'Aceite pedidos, faça entregas e veja os seus ganhos.', cta: 'Entrar como estafeta' },
  { to: '/admin', icon: 'dashboard', title: 'Admin', text: 'Gestão da plataforma: encomendas, estafetas, tarifas e relatórios.', cta: 'Abrir o painel' },
] as const;

function Landing() {
  return (
    <div className="landing">
      <header className="landing-hero">
        <Logo size={48} light slogan />
        <p>Entregas em Quelimane, de bicicleta ou motorizada.</p>
      </header>
      <main className="landing-areas">
        <h2>Escolha a sua área</h2>
        {AREAS.map((a) => (
          <Link key={a.to} to={a.to} className={`area-card area-${a.title.toLowerCase()}`}>
            <span className="area-icon">
              <Icon name={a.icon} size={30} />
            </span>
            <span className="area-text">
              <strong>{a.title}</strong>
              <small>{a.text}</small>
            </span>
            <span className="area-cta">
              {a.cta} <Icon name="chevron" size={16} />
            </span>
          </Link>
        ))}
        <p className="small center">
          <Link to="/termos">Termos</Link> · <Link to="/privacidade">Privacidade</Link>
        </p>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/cliente/*" element={<ClienteApp />} />
          <Route path="/estafeta/*" element={<EstafetaApp />} />
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="/seguir/:token" element={<Seguir />} />
          <Route path="/termos" element={<Legal kind="termos" />} />
          <Route path="/privacidade" element={<Legal kind="privacidade" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => null));
}
