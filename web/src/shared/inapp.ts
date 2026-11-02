// A app Android abre o site com «?app=android» e com «LevaGoApp» no user agent.
// Dentro da app não mostramos mapas (decisão da LevaGo, 2 de novembro de 2026).
const KEY = 'levago.inapp';

function detect(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('app') === 'android') localStorage.setItem(KEY, '1');
    return navigator.userAgent.includes('LevaGoApp') || localStorage.getItem(KEY) === '1';
  } catch {
    return navigator.userAgent.includes('LevaGoApp');
  }
}

export const IN_APP = typeof window !== 'undefined' && detect();
if (IN_APP) document.documentElement.classList.add('in-app');
