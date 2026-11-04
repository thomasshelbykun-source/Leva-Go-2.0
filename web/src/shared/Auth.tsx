import { IN_APP } from './inapp';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { setToken } from './api';
import { Button, ErrorBox, Field, Notice, useAction } from './ui';
import { useSession } from './session';
import { Icon, Logo, type IconName } from './brand';
import { PasswordInput, PhoneInput } from './Hero';

const AREA = { cliente: 'Cliente', estafeta: 'Estafeta', admin: 'Admin' } as const;

/**
 * Cliente e Estafeta (mockups de 2026-11-04).
 * - "photo": fotografia em cima com o título à direita (Entrar).
 * - "navy": faixa azul com a caixa laranja (Criar conta, Recuperar acesso).
 * O formulário fica num cartão branco por baixo.
 */
function AuthPage({ variant, title, sub, children }: { variant: 'photo' | 'navy'; title: string; sub?: string; children: React.ReactNode }) {
  const s = useSession();
  return (
    <div className={`au au-${variant} au-${s.app}`}>
      <div className="au-inner">
        <header className="au-head">
          <div className="au-bar">
            <button type="button" className="au-back" aria-label="Voltar" onClick={() => history.back()}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 12H4M10 6l-6 6 6 6" />
              </svg>
            </button>
            <div className="au-logo">
              <Logo size={30} light />
              <svg className="au-swoosh" viewBox="0 0 200 14" aria-hidden="true">
                <path d="M4 12C60 1 140 0 196 6" fill="none" stroke="var(--orange)" strokeWidth="5" strokeLinecap="round" />
              </svg>
            </div>
          </div>
          {variant === 'navy' && <img className="au-box" src="/img/auth-box.webp" alt="" />}
          <div className="au-titles">
            <h1>{title}</h1>
            {sub && <p>{sub}</p>}
          </div>
        </header>
        <div className="au-card">{children}</div>
      </div>
    </div>
  );
}

/** Campo com ícone à esquerda, como nos mockups. */
function IconField({
  icon, label, required, hint, hintIcon, error, children,
}: { icon: IconName; label: string; required?: boolean; hint?: string; hintIcon?: IconName; error?: string | null; children: React.ReactNode }) {
  return (
    <div className={`au-field ${error ? 'has-error' : ''}`}>
      <span className="au-field-icon"><Icon name={icon} size={30} /></span>
      <label className="au-field-body">
        <span className="au-label">
          {label}
          {required && <span className="au-req"> *</span>}
        </span>
        {children}
        {hint && !error && (
          <span className="au-hint">
            {hintIcon && <Icon name={hintIcon} size={18} />} {hint}
          </span>
        )}
        {error && <span className="field-error">{error}</span>}
      </label>
    </div>
  );
}

function SubmitButton({ busy, disabled, children }: { busy?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button className="au-submit" disabled={busy || disabled}>
      {busy ? 'Aguarde…' : children} {!busy && <Icon name="arrowRight" size={26} />}
    </button>
  );
}

/** Mostra em que área a pessoa está e deixa mudar de área sem confusão. */
function AreaSwitch() {
  const s = useSession();
  return (
    <div className="au-area">
      <span>
        <Icon name="user" size={20} /> Estás na área <strong>{AREA[s.app]}</strong>
      </span>
      <span className="au-area-sep" aria-hidden="true" />
      <Link to="/" reloadDocument={IN_APP}>
        <Icon name="swap" size={20} /> Mudar de área
      </Link>
    </div>
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
    const r = await a.run(() => s.api.post<{ token: string; app?: string }>('/auth/login', { phone, password, app: s.app }));
    if (r && r.app === 'admin' && s.app !== 'admin') {
      // Conta de Admin no login de Estafeta: abre o painel.
      setToken('admin', r.token);
      window.location.assign('/admin');
      return;
    }
    if (r) {
      await s.signIn(r.token);
      nav(loc.state?.from ?? s.base, { replace: true });
    }
  };

  if (s.app === 'admin')
    return (
      <div className="admin-login">
        <form className="card stack" onSubmit={submit}>
          <div className="brand">
            <Logo size={34} />
            <h1>Painel Administrativo</h1>
            <small>Gestão da LevaGo</small>
          </div>
          <Field label="Email ou telemóvel">
            <input autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="admin@levago.co.mz" required />
          </Field>
          <Field label="Palavra-passe">
            <PasswordInput value={password} onChange={setPassword} />
          </Field>
          <ErrorBox error={a.error} />
          <Button busy={a.busy}>Entrar</Button>
          <Link className="small center" to={`${s.base}/recuperar`}>
            Esqueceu a palavra-passe?
          </Link>
        </form>
        <div className="admin-login-art" aria-hidden="true">
          <Logo size={56} light slogan />
        </div>
      </div>
    );

  const courier = s.app === 'estafeta';
  return (
    <AuthPage
      variant="photo"
      title={courier ? 'Entrar como estafeta' : 'Entrar na tua conta'}
      sub={courier ? 'Acede à tua conta e continua a fazer entregas.' : 'Acede à tua conta e continua a enviar ou receber encomendas.'}
    >
      <form className="au-form" onSubmit={submit}>
        <IconField icon="phone" label="Número de telefone" hint="Ex.: 84 123 4567">
          <PhoneInput value={phone} onChange={setPhone} />
        </IconField>
        <IconField icon="lock" label="Palavra-passe">
          <PasswordInput value={password} onChange={setPassword} placeholder="Introduz a tua palavra-passe" />
        </IconField>
        <ErrorBox error={a.error} />
        <SubmitButton busy={a.busy}>Entrar</SubmitButton>
        <Link className="au-forgot" to={`${s.base}/recuperar`}>
          Esqueceste a palavra-passe?
        </Link>
        <p className="au-alt">
          Ainda não tens conta? <Link to={`${s.base}/registo`}>Registar</Link>
        </p>
        <AreaSwitch />
      </form>
    </AuthPage>
  );
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
  const courier = s.app === 'estafeta';
  const done = async (token: string) => {
    await s.signIn(token);
    nav(courier ? `${s.base}/candidatura` : s.base, { replace: true });
  };

  if (ver) {
    return (
      <AuthPage variant="navy" title="Confirmar e-mail" sub={`Enviámos um código de 6 dígitos para ${f.email}. Vê também a pasta de spam.`}>
        <form
          className="au-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await a.run(() => s.api.post<{ token: string }>('/auth/register/verify', { verification_id: ver.verification_id, code }));
            if (r) await done(r.token);
          }}
        >
          {ver.dev_code && <Notice tone="warn">Ambiente de teste: o código é {ver.dev_code}</Notice>}
          <IconField icon="mail" label="Código">
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          </IconField>
          <ErrorBox error={a.error} />
          <SubmitButton busy={a.busy} disabled={code.length !== 6}>
            Confirmar
          </SubmitButton>
          <button type="button" className="au-forgot au-linkbtn" onClick={() => setVer(null)}>
            Alterar dados
          </button>
        </form>
      </AuthPage>
    );
  }

  return (
    <AuthPage
      variant="navy"
      title={courier ? 'Criar conta de estafeta' : 'Criar conta'}
      sub={courier ? 'Regista-te e começa a fazer entregas com a LevaGo.' : 'Regista-te e começa a enviar ou receber encomendas com a LevaGo.'}
    >
      <form
        className="au-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await a.run(() =>
            s.api.post<{ token?: string; verification_id?: string; dev_code?: string }>('/auth/register/start', { ...f, email: f.email.trim() || undefined, app: s.app }),
          );
          if (r?.token) await done(r.token);
          else if (r?.verification_id) setVer({ verification_id: r.verification_id, dev_code: r.dev_code });
        }}
      >
        <IconField icon="user" label="Nome completo" required error={fieldErr('name')}>
          <input autoComplete="name" value={f.name} onChange={set('name')} placeholder="Ex.: Eduardo da Costa" required />
        </IconField>
        <IconField icon="phone" label="Telemóvel" required hint="Vodacom, Tmcel ou Movitel (8X XXX XXXX)" hintIcon="info" error={fieldErr('phone')}>
          <PhoneInput value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
        </IconField>
        <IconField icon="mail" label="E-mail (opcional)" hint="Se indicares, enviaremos o código de confirmação para este e-mail." error={fieldErr('email')}>
          <input type="email" autoComplete="email" value={f.email} onChange={set('email')} placeholder="Ex.: eduardo@gmail.com" />
        </IconField>
        <IconField icon="lock" label="Palavra-passe" required hint="Mínimo de 8 caracteres, com letras e números." hintIcon="shieldCheck" error={fieldErr('password')}>
          <PasswordInput autoComplete="new-password" value={f.password} onChange={(v) => setF({ ...f, password: v })} placeholder="Cria uma palavra-passe" />
        </IconField>
        <label className="au-check">
          <input type="checkbox" checked={f.consent_terms} onChange={set('consent_terms')} /> <span>Aceito os <Link to="/termos">Termos de Utilização</Link></span>
        </label>
        <label className="au-check">
          <input type="checkbox" checked={f.consent_privacy} onChange={set('consent_privacy')} /> <span>Aceito a <Link to="/privacidade">Política de Privacidade</Link></span>
        </label>
        <ErrorBox error={a.error} />
        <SubmitButton busy={a.busy} disabled={!f.consent_terms || !f.consent_privacy}>
          Continuar
        </SubmitButton>
        <p className="au-alt">
          Já tens conta? <Link to={`${s.base}/entrar`}>Entrar</Link>
        </p>
      </form>
    </AuthPage>
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
  const body = done ? (
    <div className="au-form">
      <Notice tone="ok">Palavra-passe alterada. Todas as sessões antigas foram terminadas.</Notice>
      <button className="au-submit" type="button" onClick={() => nav(`${s.base}/entrar`)}>
        Entrar <Icon name="arrowRight" size={26} />
      </button>
    </div>
  ) : !ver ? (
    <form
      className="au-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await a.run(() => s.api.post('/auth/reset/start', { phone }));
        if (r) setVer(r);
      }}
    >
      <IconField icon="phone" label="Telemóvel">
        <PhoneInput value={phone} onChange={setPhone} />
      </IconField>
      <ErrorBox error={a.error} />
      <SubmitButton busy={a.busy}>Enviar código</SubmitButton>
    </form>
  ) : (
    <form
      className="au-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await a.run(() => s.api.post('/auth/reset/finish', { verification_id: ver.verification_id, code, password }));
        if (r) setDone(true);
      }}
    >
      <Notice>{ver.message}</Notice>
      {ver.dev_code && <Notice tone="warn">Ambiente de teste: o código é {ver.dev_code}</Notice>}
      <IconField icon="mail" label="Código">
        <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
      </IconField>
      <IconField icon="lock" label="Nova palavra-passe" hint="8 ou mais caracteres, com letras e números">
        <PasswordInput autoComplete="new-password" value={password} onChange={setPassword} />
      </IconField>
      <ErrorBox error={a.error} />
      <SubmitButton busy={a.busy}>Alterar palavra-passe</SubmitButton>
    </form>
  );
  if (s.app === 'admin')
    return (
      <div className="auth">
        <div className="card stack">
          <h1>Recuperar acesso</h1>
          {body}
          <Link className="small center" to={`${s.base}/entrar`}>Voltar ao início de sessão</Link>
        </div>
      </div>
    );
  return (
    <AuthPage variant="navy" title="Recuperar acesso">
      {body}
      <p className="au-alt">
        <Link to={`${s.base}/entrar`}>Voltar ao início de sessão</Link>
      </p>
    </AuthPage>
  );
}
