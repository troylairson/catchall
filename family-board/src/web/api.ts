import { useCallback, useEffect, useRef, useState } from 'react';
import type { Board } from '../shared/types';

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `The server answered ${res.status}.`);
  return data as T;
}

/** Subscribes to server changes. Calls `onChange` when anything is edited anywhere. */
function useLiveUpdates(onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: number | undefined;
    const connect = () => {
      es = new EventSource('/api/stream');
      es.addEventListener('change', () => cb.current());
      // Refresh after a reconnect in case something changed while disconnected.
      es.addEventListener('hello', () => cb.current());
      es.onerror = () => {
        es?.close();
        retry = window.setTimeout(connect, 5000);
      };
    };
    connect();
    return () => { es?.close(); window.clearTimeout(retry); };
  }, []);
}

export interface BoardState {
  board: Board | null;
  error: string | null;
  /** When the last successful load happened, for the "last updated" note. */
  loadedAt: Date | null;
  reload: () => void;
}

/** Loads the board for a range (default: this week) and keeps it fresh. */
export function useBoard(range?: { from: string; to: string }): BoardState {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const query = range ? `?from=${range.from}&to=${range.to}` : '';

  const reload = useCallback(() => {
    api<Board>('GET', `/api/board${query}`)
      .then(b => { setBoard(b); setError(null); setLoadedAt(new Date()); })
      .catch((e: Error) => setError(e.message || 'Can’t reach the Family Board server.'));
  }, [query]);

  useEffect(() => { reload(); }, [reload]);
  useLiveUpdates(reload);

  // Refresh every 5 minutes, and soon after midnight so "today" rolls over.
  useEffect(() => {
    const id = window.setInterval(reload, 5 * 60_000);
    return () => window.clearInterval(id);
  }, [reload]);

  return { board, error, loadedAt, reload };
}

/** Re-renders every `ms` milliseconds; used for clocks and the "now" line. */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
