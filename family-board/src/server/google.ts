/** Google Calendar, read-only. Sign-in uses OAuth for an installed ("Desktop app")
 *  client with PKCE. Google redirects to a loopback address that won't load on the
 *  person's device; they paste that address back into Family Board, which finishes the
 *  sign-in. No public HTTPS address is needed. */

import { createHash, randomBytes } from 'node:crypto';
import type { ParsedEvent } from './ics';
import type { ProviderSession, RemoteCalendar } from './providers';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
/** Loopback redirect, allowed for Desktop-app clients without registering it. */
export const GOOGLE_REDIRECT = 'http://127.0.0.1:8710/';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';

export type FetchFn = typeof fetch;

export interface GoogleClient { clientId: string; clientSecret: string }

export class GoogleError extends Error {
  constructor(message: string, readonly code: string, readonly status?: number) { super(message); }
}

/** Turns Google failures into messages a person can act on. */
export function googleError(err: unknown): string {
  const e = err as Partial<GoogleError> & { message?: string };
  const msg = String(e?.message ?? err);
  if (e?.code === 'invalid_grant') {
    return 'Google access expired or was removed. Connect this Google account again in Settings. '
      + 'If this keeps happening every week, the Google Cloud app is still in “Testing”: publish it (Audience → Publish app).';
  }
  if (e?.code === 'invalid_client' || e?.code === 'unauthorized_client') {
    return 'Google didn’t accept the client ID or secret. Check them under Settings → Calendars → Google setup.';
  }
  if (e?.code === 'accessNotConfigured' || /has not been used|is disabled/i.test(msg)) {
    return 'The Google Calendar API isn’t turned on for your Google Cloud project. Enable it under APIs & Services → Library.';
  }
  if (e?.status === 401) return 'Google sign-in for this account stopped working. Connect it again in Settings.';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|fetch failed|network|timeout/i.test(msg)) {
    return 'Couldn’t reach Google. Check that the box is online; it will try again in a few minutes.';
  }
  return `Google sync failed: ${msg}`;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/** Sign-in in progress, keyed by the OAuth state value. Kept for 30 minutes. */
interface Pending { personId: string; verifier: string; created: number }

export class GoogleAuth {
  private pending = new Map<string, Pending>();

  constructor(private readonly fetchFn: FetchFn = fetch, private readonly now: () => number = Date.now) {}

  /** The Google sign-in address for one person's account. */
  start(client: GoogleClient, personId: string): string {
    for (const [k, p] of this.pending) if (this.now() - p.created > 30 * 60_000) this.pending.delete(k);
    const state = randomBytes(16).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    this.pending.set(state, { personId, verifier, created: this.now() });
    const q = new URLSearchParams({
      client_id: client.clientId, redirect_uri: GOOGLE_REDIRECT, response_type: 'code', scope: GOOGLE_SCOPE,
      access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256',
    });
    return `${AUTH_URL}?${q}`;
  }

  /** Reads the pasted address (or bare code), and trades the code for tokens. */
  async finish(client: GoogleClient, pasted: string): Promise<{ personId: string; refreshToken: string; accessToken: string }> {
    const text = pasted.trim();
    let params: URLSearchParams;
    try {
      params = new URL(text).searchParams;
    } catch {
      params = new URLSearchParams(text.includes('code=') ? text.slice(text.indexOf('?') + 1) : '');
    }
    if (params.get('error')) {
      throw new GoogleError(params.get('error') === 'access_denied'
        ? 'Google sign-in was cancelled. Start again and choose Continue on Google’s screens.'
        : `Google sign-in failed: ${params.get('error')}`, 'denied');
    }
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) {
      throw new GoogleError('That doesn’t look like the address from after sign-in. Copy the whole address from the tab that failed to load (it starts with http://127.0.0.1:8710/?).', 'bad_paste');
    }
    const pending = this.pending.get(state);
    if (!pending) {
      throw new GoogleError('This sign-in has expired or was already used. Start again with “Sign in with Google”.', 'stale');
    }
    this.pending.delete(state);

    const res = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: GOOGLE_REDIRECT,
        grant_type: 'authorization_code', code_verifier: pending.verifier,
      }),
    });
    const body = await json(res);
    if (!res.ok) throw new GoogleError(String(body.error_description ?? body.error ?? res.status), String(body.error ?? 'token'), res.status);
    if (typeof body.refresh_token !== 'string') {
      throw new GoogleError('Google didn’t return offline access. Remove Family Board at myaccount.google.com/permissions, then sign in again.', 'no_refresh');
    }
    return { personId: pending.personId, refreshToken: body.refresh_token, accessToken: String(body.access_token) };
  }

  async accessToken(client: GoogleClient, refreshToken: string): Promise<string> {
    const res = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.clientId, client_secret: client.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token',
      }),
    });
    const body = await json(res);
    if (!res.ok) throw new GoogleError(String(body.error_description ?? body.error ?? res.status), String(body.error ?? 'token'), res.status);
    return String(body.access_token);
  }
}

interface GoogleTime { date?: string; dateTime?: string }
interface GoogleEvent {
  id: string; iCalUID?: string; status?: string; summary?: string; location?: string; description?: string;
  start?: GoogleTime; end?: GoogleTime;
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
}

/** A signed-in Google account: its calendars and their events. */
export function googleSession(accessToken: string, fetchFn: FetchFn = fetch): ProviderSession & { primaryEmail(): Promise<string> } {
  const get = async (path: string, query: Record<string, string> = {}) => {
    const res = await fetchFn(`${API}${path}?${new URLSearchParams(query)}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body = await json(res);
    if (!res.ok) {
      const error = body.error as { message?: string; errors?: Array<{ reason?: string }> } | undefined;
      throw new GoogleError(error?.message ?? `HTTP ${res.status}`, error?.errors?.[0]?.reason ?? 'api', res.status);
    }
    return body;
  };

  const pages = async <T>(path: string, query: Record<string, string>): Promise<T[]> => {
    const out: T[] = [];
    let pageToken = '';
    for (let i = 0; i < 50; i++) {
      const body = await get(path, pageToken ? { ...query, pageToken } : query);
      out.push(...((body.items as T[]) ?? []));
      pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : '';
      if (!pageToken) break;
    }
    return out;
  };

  type ListEntry = { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; primary?: boolean; accessRole?: string };
  let cache: ListEntry[] | null = null;
  const list = async () => (cache ??= await pages<ListEntry>('/users/me/calendarList', { maxResults: '250' }));

  return {
    async listCalendars(): Promise<RemoteCalendar[]> {
      return (await list())
        // Free/busy-only calendars have no event details to show.
        .filter(c => c.accessRole !== 'freeBusyReader')
        .map(c => ({
          url: c.id,
          name: c.summaryOverride || c.summary || c.id,
          color: c.backgroundColor ?? '',
          ctag: null,
          // Holidays, birthdays and other people's read-only calendars start hidden.
          enabledByDefault: c.primary === true || c.accessRole === 'owner' || c.accessRole === 'writer',
        }));
    },

    async fetchEvents(calendarId: string, from: string, to: string): Promise<ParsedEvent[]> {
      const items = await pages<GoogleEvent>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
        timeMin: `${from}T00:00:00Z`, timeMax: `${to}T23:59:59Z`, singleEvents: 'true', maxResults: '2500',
        fields: 'nextPageToken,items(id,iCalUID,status,summary,location,description,start,end,attendees(self,responseStatus))',
      });
      return items
        .filter(e => e.status !== 'cancelled' && e.start && e.end)
        .filter(e => !e.attendees?.some(a => a.self && a.responseStatus === 'declined'))
        .map(e => {
          const allDay = !!e.start!.date;
          return {
            uid: e.iCalUID ?? e.id,
            title: e.summary?.trim() || '(No title)',
            allDay,
            start: allDay ? e.start!.date! : new Date(e.start!.dateTime!).toISOString(),
            end: allDay ? e.end!.date! : new Date(e.end!.dateTime!).toISOString(),
            location: e.location?.trim() ?? '',
            notes: e.description?.trim() ?? '',
          };
        });
    },

    async primaryEmail(): Promise<string> {
      const primary = (await list()).find(c => c.primary);
      return primary?.id ?? 'Google account';
    },
  };
}
