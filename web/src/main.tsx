import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { Loading } from './shared/ui';
import './styles.css';

// Cada aplicação carrega à parte: o cliente não descarrega o código do painel Admin.
const ClienteApp = lazy(() => import('./cliente/App'));
const EstafetaApp = lazy(() => import('./estafeta/App'));
const AdminApp = lazy(() => import('./admin/App'));

function Legal({ kind }: { kind: 'termos' | 'privacidade' }) {
  return (
    <div className="page">
      <header className="page-head">
        <button className="icon-btn" aria-label="Voltar" onClick={() => history.back()}>
          ←
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

function Landing() {
  return (
    <div className="welcome">
      <img src="/icon.svg" alt="" width={88} height={88} />
      <h1>LevaGo</h1>
      <p className="slogan">A tua entrega, o nosso compromisso!</p>
      <Link className="btn btn-primary" to="/cliente">
        Enviar uma encomenda
      </Link>
      <Link className="btn btn-secondary" to="/estafeta">
        Sou estafeta
      </Link>
      <Link className="small" to="/admin">
        Painel administrativo
      </Link>
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
