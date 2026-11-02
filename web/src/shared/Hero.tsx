import { useState, type ReactNode } from 'react';
import { Logo } from './brand';

/**
 * Ecrã de entrada ao estilo das apps de mobilidade: fotografia em cima e um painel branco
 * com cantos arredondados em baixo. Em ecrãs largos, a fotografia fica à esquerda.
 */
export function HeroSheet({
  img,
  compact = false,
  back,
  children,
}: {
  img: 'cliente' | 'estafeta';
  compact?: boolean;
  back?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`hs ${compact ? 'hs-compact' : ''}`}>
      <div className="hs-photo" style={{ backgroundImage: `url(/img/bg-${img}.webp)` }}>
        <div className="hs-top">
          {back && (
            <button type="button" className="hs-back" aria-label="Voltar" onClick={() => history.back()}>
              ←
            </button>
          )}
          <Logo size={26} light />
        </div>
      </div>
      <div className="hs-sheet">
        <span className="hs-grip" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

/** Campo de telemóvel com o indicativo de Moçambique à vista. */
export function PhoneInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="phone-input">
      <span className="phone-prefix" aria-hidden="true">
        <span className="flag-mz" /> +258
      </span>
      <input
        inputMode="tel"
        autoComplete="tel"
        aria-label="Número de telefone"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="84 123 4567"
        required
      />
    </div>
  );
}

/** Palavra-passe com botão para mostrar ou ocultar. */
export function PasswordInput({
  value,
  onChange,
  autoComplete = 'current-password',
  minLength,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  minLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="pass-input">
      <input
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
      <button type="button" className="pass-toggle" onClick={() => setShow(!show)}>
        {show ? 'Ocultar' : 'Mostrar'}
      </button>
    </div>
  );
}
