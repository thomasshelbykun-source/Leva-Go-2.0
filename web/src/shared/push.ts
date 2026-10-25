import type { Api } from './api';

// Avisos no telemóvel (Web Push). Só funcionam se a API tiver as chaves VAPID.
export type PushState = 'unsupported' | 'unavailable' | 'denied' | 'off' | 'on';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration()) ?? navigator.serviceWorker.register('/sw.js');
}

export async function pushState(api: Api): Promise<PushState> {
  if (!supported()) return 'unsupported';
  try {
    const k = await api.get<{ enabled: boolean }>('/push/key');
    if (!k.enabled) return 'unavailable';
  } catch {
    return 'unavailable';
  }
  if (Notification.permission === 'denied') return 'denied';
  const sub = await (await registration()).pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush(api: Api): Promise<PushState> {
  const { public_key } = await api.get<{ public_key: string }>('/push/key');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(public_key) }));
  await api.post('/push/subscribe', sub.toJSON());
  return 'on';
}

export async function disablePush(api: Api): Promise<PushState> {
  const sub = await (await registration()).pushManager.getSubscription();
  if (sub) {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => null);
    await sub.unsubscribe();
  }
  return 'off';
}
