import type { Prefs } from './alerts';
import { DEFAULT_PREFS } from './alerts';
import { serverUrl } from './api/http';
import { loadFavorites } from './teams';

const PREFS_KEY = 'scores.alertPrefs.v1';

export function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export type PushSupport = 'ok' | 'install-first' | 'unsupported';

/** iPhone only allows web push for apps added to the Home Screen. */
export function pushSupport(): PushSupport {
  const hasApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (ios && !standalone) return 'install-first';
  return hasApi ? 'ok' : 'unsupported';
}

function b64uToBytes(s: string) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function api(path: string, body?: unknown) {
  const base = serverUrl();
  if (!base) throw new Error('Set the Scores server URL first.');
  const res = await fetch(`${base}${path}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
  return data;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

const appUrl = () => location.href.split('#')[0];

/** Ask permission (must run from a tap), subscribe, and register teams + preferences with the server. */
export async function enablePush(prefs = loadPrefs()) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in Settings → Notifications → Scores.');
  const { publicKey } = await api('/api/vapid');
  if (!publicKey) throw new Error('The server has no VAPID key configured yet.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
  savePrefs(prefs);
  await api('/api/subscribe', { subscription: sub.toJSON(), teams: loadFavorites(), prefs, app: appUrl() });
}

/** Re-send teams and preferences (after editing favorites or toggles). No-op when not subscribed. */
export async function syncPush(prefs = loadPrefs()) {
  savePrefs(prefs);
  const sub = await currentSubscription();
  if (!sub || !serverUrl()) return;
  await api('/api/subscribe', { subscription: sub.toJSON(), teams: loadFavorites(), prefs, app: appUrl() });
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/api/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

export async function testPush() {
  const sub = await currentSubscription();
  if (!sub) throw new Error('Notifications are off.');
  await api('/api/test', { endpoint: sub.endpoint });
}
