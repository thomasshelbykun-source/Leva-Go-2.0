import { Icon } from './brand';
import { IN_APP } from './inapp';

/** Endereço fixo da última versão do APK (página de versões do GitHub, actualizada em cada construção). */
export const APK_URL = 'https://github.com/thomasshelbykun-source/Leva-Go-2.0/releases/download/apk-latest/LevaGo.apk';

/** Botão «Baixar a app Android». Não aparece dentro da própria app. */
export function AppDownload({ className = 'app-dl' }: { className?: string }) {
  if (IN_APP) return null;
  return (
    <a className={className} href={APK_URL} rel="noopener">
      <Icon name="download" size={20} /> Baixar a app Android
    </a>
  );
}
