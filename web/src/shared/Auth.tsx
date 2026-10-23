import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, ErrorBox, Field, Notice, useAction } from './ui';
import { useSession } from './session';
import { Logo } from './brand';

const AREA = { cliente: 'Cliente', estafeta: 'Estafeta', admin: 'Admin' } as const;

function Brand({ title }: { title: string }) {
  return (
    <div className="brand">
      <Logo size={34} />
      <h1>{title}</h1>
    </div>
  );
}

/** Mostra em que área a pessoa está e deixa mudar de área sem confusão. */
function AreaSwitch() {
  const s = useSession();
  return (
    <p className="small center area-switch">
      Está na área <strong>{AREA[s.app]}</strong> · <Link to="/">Mudar de área</Link>
    </p>
  );
}

export function Login() {
  const s = useSession();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const a = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await a.run(() => s.api.post<{ token: string }>('/auth/login', { phone, password, app: s.app }));
    if (r) {
      await s.signIn(r.token);
      nav(loc.state?.from ?? s.base, { replace: true });
    }
  };
  const admin = s.app === 'admin';
  const form = (
    <form className="card stack" onSubmit={submit}>
      {admin ? (
        <div className="brand">
          <Logo size={34} />
          <h1>Painel Administrativo</h1>
          <small>Gestão da LevaGo</small>
        </div>
      ) : (
        <Brand title={s.app === 'estafeta' ? 'Entrar como estafeta' : 'Entrar na tua conta'} />
      )}
      {admin ? (
        <Field label="Email ou telemóvel">
          <input autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="admin@levago.co.mz" required />
        </Field>
      ) : (
        <Field label="Número de telefone" hint="Ex.: 84 123 4567">
          <input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+258 8X XXX XXXX" required />
        </Field>
      )}
        <Field label="Palavra-passe">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
      <ErrorBox error={a.error} />
      <Button busy={a.busy}>Entrar</Button>
      <Link className="small center" to={`${s.base}/recuperar`}>
        Esqueceu a palavra-passe?
      </Link>
      {!admin && (
        <p className="small center">
          Ainda não tem conta? <Link to={`${s.base}/registo`}>Registar</Link>
        </p>
      )}
      <AreaSwitch />
    </form>
  );
  if (admin)
    return (
      <div className="admin-login">
        {form}
        <div className="admin-login-art" aria-hidden="true">
          <Logo size={56} light slogan />
        </div>
      </div>
    );
  return <div className="auth">{form}</div>;
}

export function Register() {
  const s = useSession();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', phone: '', email: '', password: '', consent_terms: false, consent_privacy: false });
  const [ver, setVer] = useState<{ verification_id: string; dev_code?: string } | null>(null);
  const [code, setCode] = useState('');
  const a = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const fieldErr = (k: string) => (a.error?.details as Record<string, string> | null)?.[k];

  if (ver) {
    return (
      <div className="auth">
        <form
          className="card stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await a.run(() => s.api.post<{ token: string }>('/auth/register/verify', { verification_id: ver.verification_id, code }));
            if (r) {
              await s.signIn(r.token);
              nav(s.app === 'estafeta' ? `${s.base}/candidatura` : s.base, { replace: true });
            }
          }}
        >
          <Brand title="Confirmar telemóvel" />
          <p>Enviámos um código de 6 dígitos por SMS para {f.phone}.</p>
          {ver.dev_code && <Notice tone="warn">Ambiente de teste: o código é {ver.dev_code}</Notice>}
          <Field label="Código">
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          </Field>
          <ErrorBox error={a.error} />
          <Button busy={a.busy} disabled={code.length !== 6}>
            Confirmar
          </Button>
          <Button type="button" kind="ghost" onClick={() => setVer(null)}>
            Alterar dados
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="auth">
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await a.run(() => s.api.post('/auth/register/start', { ...f, email: f.email || undefined, app: s.app }));
          if (r) setVer(r);
        }}
      >
        <Brand title={s.app === 'estafeta' ? 'Criar conta de estafeta' : 'Criar conta'} />
        <Field label="Nome completo" error={fieldErr('name')}>
          <input autoComplete="name" value={f.name} onChange={set('name')} required />
        </Field>
        <Field label="Telemóvel" hint="Vodacom, Tmcel ou Movitel (8X XXX XXXX)" error={fieldErr('phone')}>
          <input inputMode="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} required />
        </Field>
        <Field label="Email (opcional)" error={fieldErr('email')}>
          <input type="email" autoComplete="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Palavra-passe" hint="8 ou mais caracteres, com letras e números" error={fieldErr('password')}>
          <input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required />
        </Field>
        <label className="check">
          <input type="checkbox" checked={f.consent_terms} onChange={set('consent_terms')} /> Aceito os <Link to="/termos">Termos de utilização</Link>
        </label>
        <label className="check">
          <input type="checkbox" checked={f.consent_privacy} onChange={set('consent_privacy')} /> Aceito a <Link to="/privacidade">Política de privacidade</Link>
        </label>
        <ErrorBox error={a.error} />
        <Button busy={a.busy} disabled={!f.consent_terms || !f.consent_privacy}>
          Continuar
        </Button>
        <p className="small center">
          Já tem conta? <Link to={`${s.base}/entrar`}>Entrar</Link>
        </p>
        <AreaSwitch />
      </form>
    </div>
  );
}

export function ResetPassword() {
  const s = useSession();
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [ver, setVer] = useState<{ verification_id: string; dev_code?: string; message: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const a = useAction();
  return (
    <div className="auth">
      <div className="card stack">
        <Brand title="Recuperar acesso" />
        {done ? (
          <>
            <Notice tone="ok">Palavra-passe alterada. Todas as sessões antigas foram terminadas.</Notice>
            <Button onClick={() => nav(`${s.base}/entrar`)}>Entrar</Button>
          </>
        ) : !ver ? (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await a.run(() => s.api.post('/auth/reset/start', { phone }));
              if (r) setVer(r);
            }}
          >
            <Field label="Telemóvel">
              <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </Field>
            <ErrorBox error={a.error} />
            <Button busy={a.busy}>Enviar código</Button>
          </form>
        ) : (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await a.run(() => s.api.post('/auth/reset/finish', { verification_id: ver.verification_id, code, password }));
              if (r) setDone(true);
            }}
          >
            <Notice>{ver.message}</Notice>
            {ver.dev_code && <Notice tone="warn">Ambiente de teste: o código é {ver.dev_code}</Notice>}
            <Field label="Código">
              <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
            </Field>
            <Field label="Nova palavra-passe" hint="8 ou mais caracteres, com letras e números">
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <ErrorBox error={a.error} />
            <Button busy={a.busy}>Alterar palavra-passe</Button>
          </form>
        )}
        <Link className="small center" to={`${s.base}/entrar`}>
          Voltar ao início de sessão
        </Link>
      </div>
    </div>
  );
}
