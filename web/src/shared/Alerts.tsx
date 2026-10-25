import { useEffect, useState } from 'react';
import { Icon } from './brand';
import { disablePush, enablePush, pushState, type PushState } from './push';
import { useSession } from './session';
import { Button } from './ui';

/** Cartão para ligar ou desligar os avisos no telemóvel. Não aparece se o aparelho ou a API não os suportam. */
export function PushCard({ compact = false }: { compact?: boolean }) {
  const { api } = useSession();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    pushState(api).then(setState).catch(() => setState('unavailable'));
  }, [api]);

  if (!state || state === 'unsupported' || state === 'unavailable') return null;
  if (compact && state !== 'off') return null;

  const change = async (fn: () => Promise<PushState>) => {
    setBusy(true);
    try {
      setState(await fn());
    } catch {
      setState(await pushState(api).catch(() => 'unavailable' as PushState));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="live-card">
      <span className="icon-wrap">
        <Icon name="bell" />
      </span>
      <div className="txt">
        {state === 'on' && (
          <>
            <strong>Avisos ligados</strong>
            <small>Recebe um aviso quando o estado da encomenda muda.</small>
          </>
        )}
        {state === 'off' && (
          <>
            <strong>Receber avisos no telemóvel</strong>
            <small>Saiba logo quando o estafeta aceitar e quando a encomenda chegar.</small>
          </>
        )}
        {state === 'denied' && (
          <>
            <strong>Avisos bloqueados</strong>
            <small>Permita as notificações nas definições do navegador.</small>
          </>
        )}
      </div>
      {state === 'off' && (
        <Button busy={busy} onClick={() => change(() => enablePush(api))}>
          Activar
        </Button>
      )}
      {state === 'on' && (
        <Button kind="secondary" busy={busy} onClick={() => change(() => disablePush(api))}>
          Desligar
        </Button>
      )}
    </div>
  );
}
