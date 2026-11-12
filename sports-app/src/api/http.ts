export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

let memo: Map<string, Promise<any>> | undefined;

/** Run `fn` with GET responses shared by URL (the server checks several teams in one league per run). */
export async function withSharedRequests<T>(fn: () => Promise<T>): Promise<T> {
  memo = new Map();
  try {
    return await fn();
  } finally {
    memo = undefined;
  }
}

export function getJson<T = any>(url: string, timeoutMs = 12_000): Promise<T> {
  if (!memo) return fetchJson<T>(url, timeoutMs);
  if (!memo.has(url)) memo.set(url, fetchJson(url, timeoutMs));
  return memo.get(url)!;
}

async function fetchJson<T = any>(url: string, timeoutMs: number): Promise<T> {
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

/** The Scores server (Cloudflare Worker in worker/): NHL proxy + notifications. */
export function serverUrl(): string | undefined {
  return loadSettings().nhlProxy.trim().replace(/\/+$/, '') || undefined;
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
