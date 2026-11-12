export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

export async function getJson<T = any>(url: string, timeoutMs = 12_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new HttpError(res.status, url);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

const SETTINGS_KEY = 'scores.settings.v1';

export interface Settings {
  /**
   * Base URL that forwards to https://api-web.nhle.com (which sends no CORS headers).
   * Empty = use ESPN's NHL feed instead. In dev the Vite proxy at /nhl-api is used.
   */
  nhlProxy: string;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { nhlProxy: '', ...JSON.parse(raw) };
  } catch {
    /* private mode etc. */
  }
  return { nhlProxy: '' };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Where to reach the NHL API, or undefined to fall back to ESPN. */
export function nhlBase(): string | undefined {
  const p = loadSettings().nhlProxy.trim().replace(/\/+$/, '');
  if (p) return p;
  if (import.meta.env?.DEV) return '/nhl-api';
  return undefined;
}
