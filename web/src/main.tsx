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

function Illustration() {
  return (
    <svg className="landing-art" viewBox="0 0 360 210" role="img" aria-label="Estafeta de motorizada a levar uma encomenda">
      <circle cx="292" cy="52" r="26" fill="#fbd9b8" />
      <rect x="18" y="82" width="62" height="96" rx="8" fill="#e9dfd0" />
      <rect x="86" y="58" width="52" height="120" rx="8" fill="#d6e0ee" />
      <rect x="146" y="96" width="70" height="82" rx="8" fill="#f2cdb0" />
      <rect x="224" y="70" width="58" height="108" rx="8" fill="#dcd5c6" />
      <g fill="#fff" opacity=".85">
        <rect x="30" y="96" width="12" height="12" rx="3" /><rect x="54" y="96" width="12" height="12" rx="3" />
        <rect x="30" y="122" width="12" height="12" rx="3" /><rect x="54" y="122" width="12" height="12" rx="3" />
        <rect x="98" y="74" width="12" height="12" rx="3" /><rect x="116" y="74" width="12" height="12" rx="3" />
        <rect x="98" y="100" width="12" height="12" rx="3" /><rect x="116" y="100" width="12" height="12" rx="3" />
        <rect x="160" y="110" width="12" height="12" rx="3" /><rect x="190" y="110" width="12" height="12" rx="3" />
        <rect x="236" y="86" width="12" height="12" rx="3" /><rect x="258" y="86" width="12" height="12" rx="3" />
      </g>
      <rect x="0" y="178" width="360" height="32" fill="#cfc6b6" />
      <path d="M0 194h360" stroke="#fff" stroke-width="3" stroke-dasharray="18 14" opacity=".8" />
      <g transform="translate(120 112)">
        <circle cx="22" cy="68" r="14" fill="#1d2736" /><circle cx="22" cy="68" r="6" fill="#e9dfd0" />
        <circle cx="104" cy="68" r="14" fill="#1d2736" /><circle cx="104" cy="68" r="6" fill="#e9dfd0" />
        <path d="M22 68h30l14-26h20l8 26" fill="none" stroke="#0d2a4f" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M84 42l8-18h14" fill="none" stroke="#0d2a4f" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
        <rect x="-4" y="22" width="40" height="34" rx="6" fill="#f26a12" />
        <path d="M-4 34h40" stroke="#c4500a" stroke-width="3" />
        <path d="M48 42l8-22" stroke="#13213a" stroke-width="10" stroke-linecap="round" />
        <circle cx="60" cy="8" r="10" fill="#f0b48a" />
        <path d="M50 6a10 10 0 0 1 20-2v4H50z" fill="#0d2a4f" />
      </g>
    </svg>
  );
}

function Landing() {
  return (
    <div className="landing">
      <header className="landing-top">
        <Logo size={34} />
      </header>
      <main className="landing-main">
        <section className="landing-copy">
          <h1>Entregas em Quelimane</h1>
          <p>Envie uma encomenda, veja o preço antes de pedir e acompanhe o estafeta no mapa.</p>
          <div className="landing-actions">
            <Link to="/cliente" className="btn btn-primary btn-lg">
              Enviar uma encomenda
            </Link>
            <Link to="/estafeta" className="btn btn-secondary btn-lg">
              Sou estafeta
            </Link>
          </div>
          <ul className="landing-facts">
            <li>Preço claro antes de confirmar</li>
            <li>Seguimento em tempo real</li>
            <li>Até 15 km e 15 kg por entrega</li>
          </ul>
        </section>
        <Illustration />
      </main>
      <footer className="landing-foot">
        <Link to="/termos">Termos</Link>
        <Link to="/privacidade">Privacidade</Link>
      </footer>
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
