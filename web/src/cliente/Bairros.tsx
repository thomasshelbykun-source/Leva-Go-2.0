import { useMemo, useState } from 'react';
import { Icon } from '../shared/brand';

export interface Bairro {
  id: string;
  name: string;
  city?: string;
}

/** Local escolhido pelo nome do bairro, com uma referência opcional (rua, casa, ponto conhecido). */
export interface BairroPoint {
  bairro: Bairro;
  reference: string;
}

/** Compara nomes sem acentos nem maiúsculas: "icidua" encontra "Icídua". */
export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/º/g, 'o')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Bairros que correspondem ao texto escrito: primeiro os que começam pelo texto. */
export function matchBairros(list: Bairro[], text: string, max = 6): Bairro[] {
  const q = norm(text);
  if (!q) return [];
  const starts = list.filter((b) => norm(b.name).startsWith(q) || norm(b.name).split(' ').some((w) => w.startsWith(q)));
  const has = list.filter((b) => !starts.includes(b) && norm(b.name).includes(q));
  return [...starts, ...has].slice(0, max);
}

/** Campo do passo Locais: o cliente escreve o nome do bairro e escolhe da lista. */
export function BairroField({
  question,
  placeholder,
  bairros,
  value,
  onChange,
}: {
  question: string;
  placeholder: string;
  bairros: Bairro[];
  value: BairroPoint | null;
  onChange: (p: BairroPoint | null) => void;
}) {
  const [text, setText] = useState(value?.bairro.name ?? '');
  const [ref, setRef] = useState(value?.reference ?? '');
  const results = useMemo(() => (value ? [] : matchBairros(bairros, text)), [bairros, text, value]);

  const type = (t: string) => {
    setText(t);
    // Nome escrito por inteiro (sem contar acentos): fica escolhido sem tocar na lista.
    const exact = bairros.find((b) => norm(b.name) === norm(t));
    onChange(exact ? { bairro: exact, reference: ref } : null);
  };
  const pick = (b: Bairro) => {
    setText(b.name);
    onChange({ bairro: b, reference: ref });
  };

  return (
    <div className="stack-sm">
      <h3 className="ad-q">{question}</h3>
      <label className={`ad-input ${value ? 'ad-filled' : ''}`}>
        <Icon name="pin" />
        <input
          value={text}
          onChange={(e) => type(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          aria-label={question}
          maxLength={60}
        />
        {text && (
          <button
            type="button"
            className="ad-clear"
            aria-label="Limpar"
            onClick={() => {
              setText('');
              onChange(null);
            }}
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </label>
      {results.length > 0 && (
        <ul className="ad-results" role="listbox">
          {results.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => pick(b)}>
                <Icon name="pin" size={18} /> {b.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {text.trim().length >= 2 && !value && results.length === 0 && (
        <p className="field-error">Não encontrámos este bairro na nossa área. Verifique o nome ou contacte o apoio.</p>
      )}
      {value && (
        <input
          className="ad-ref"
          value={ref}
          maxLength={200}
          placeholder="Rua, casa ou ponto de referência (opcional)"
          aria-label="Referência"
          onChange={(e) => {
            setRef(e.target.value);
            onChange({ ...value, reference: e.target.value });
          }}
        />
      )}
    </div>
  );
}
