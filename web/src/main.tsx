import { IN_APP } from './shared/inapp';
import { Component, lazy, StrictMode, Suspense, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { Icon } from './shared/brand';
import { HeroSheet } from './shared/Hero';
import { Loading } from './shared/ui';
import './styles.css';

// Cada aplicação carrega à parte: o cliente não descarrega o código do painel Admin.
// Depois de uma nova versão do site, um ficheiro antigo pode já não existir: recarrega uma vez.
function lazyRetry(load: () => Promise<{ default: ComponentType }>) {
  return lazy(async () => {
    try {
      return await load();
    } catch (err) {
      const key = 'levago.reloaded';
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(key) ?? 0);
        if (Date.now() - last > 30_000) {
          sessionStorage.setItem(key, String(Date.now()));
          window.location.reload();
          return new Promise<never>(() => undefined);
        }
      } catch {
        /* sem armazenamento: mostra o erro */
      }
      throw err;
    }
  });
}

const ClienteApp = lazyRetry(() => import('./cliente/App'));
const EstafetaApp = lazyRetry(() => import('./estafeta/App'));
const AdminApp = lazyRetry(() => import('./admin/App'));

/** Se algo falhar ao abrir, mostra uma mensagem e um botão, nunca um ecrã vazio. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="state">
        <p>
          <strong>Não foi possível abrir a LevaGo.</strong>
        </p>
        <p className="small">Verifique a internet e tente de novo.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Tentar de novo
        </button>
      </div>
    );
  }
}

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
    <HeroSheet img="cliente">
      <div className="hs-head">
        <h1 className="hs-title">Escolha a sua área</h1>
        <p className="hs-sub">Entregas rápidas e seguras em Quelimane, de bicicleta ou motorizada.</p>
      </div>
      <div className="choice-list">
        <Link to="/cliente" className="choice">
          <span className="choice-icon">
            <Icon name="box" size={26} />
          </span>
          <span className="choice-text">
            <strong>Cliente</strong>
            <small>Envie encomendas, pague e acompanhe a entrega.</small>
          </span>
          <span className="choice-go" aria-hidden="true">›</span>
        </Link>
        <Link to="/estafeta" className="choice choice-alt">
          <span className="choice-icon">
            <Icon name="scooter" size={26} />
          </span>
          <span className="choice-text">
            <strong>Estafeta</strong>
            <small>Aceite pedidos, faça entregas e veja os seus ganhos.</small>
          </span>
          <span className="choice-go" aria-hidden="true">›</span>
        </Link>
      </div>
      <p className="small center">
        <Link to="/termos">Termos</Link> · <Link to="/privacidade">Privacidade</Link>
      </p>
    </HeroSheet>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary>
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
    </Boundary>
  </StrictMode>,
);

if ('serviceWorker' in navigator && IN_APP) {
  // Dentro da app Android a WebView já guarda o necessário; um service worker antigo pode prender a app num ecrã.
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => null);
  if ('caches' in window) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => null);
} else if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => null));
}
