import { beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { Store } from '../store';
import { seedIfEmpty } from '../seed';
import { Secrets } from '../secrets';
import { CalendarSync } from '../sync';
import { createApp } from '../app';
import type { CalDavClient, Connect } from '../caldav';
import type { Board } from '../../shared/types';

const NOW = new Date('2026-11-13T19:40:00Z');
const CLIENT_ID = '123-abc.apps.googleusercontent.com';

/** A fake Google: token endpoint and Calendar API, checking PKCE and the bearer token. */
class FakeGoogle {
  challenge = '';
  revoked = false;
  requests: string[] = [];
  calendars = [
    { id: 'troy@gmail.com', summary: 'troy@gmail.com', backgroundColor: '#039be5', primary: true, accessRole: 'owner' },
    { id: 'fam123@group.calendar.google.com', summary: 'Family Sports', backgroundColor: '#33b679', accessRole: 'writer' },
    { id: 'en.usa#holiday@group.v.calendar.google.com', summary: 'Holidays in United States', accessRole: 'reader' },
    { id: 'boss@work.com', summary: 'Boss', accessRole: 'freeBusyReader' },
  ];
  events: Record<string, object[]> = {
    'troy@gmail.com': [
      { id: 'a', iCalUID: 'a@google.com', summary: 'Haircut', start: { dateTime: '2026-11-13T09:00:00-05:00' }, end: { dateTime: '2026-11-13T09:30:00-05:00' } },
      { id: 'b', iCalUID: 'shared-dentist', summary: 'Dentist', start: { dateTime: '2026-11-13T08:00:00-05:00' }, end: { dateTime: '2026-11-13T09:00:00-05:00' } },
      { id: 'c', summary: 'Cancelled thing', status: 'cancelled', start: { dateTime: '2026-11-13T10:00:00-05:00' }, end: { dateTime: '2026-11-13T11:00:00-05:00' } },
      { id: 'd', summary: 'Declined meeting', start: { dateTime: '2026-11-13T12:00:00-05:00' }, end: { dateTime: '2026-11-13T13:00:00-05:00' }, attendees: [{ self: true, responseStatus: 'declined' }] },
    ],
    'fam123@group.calendar.google.com': [
      { id: 'e', summary: 'Lincoln tournament', start: { date: '2026-11-14' }, end: { date: '2026-11-16' } },
      { id: 'f', summary: 'Everly swim meet', start: { dateTime: '2026-11-15T08:00:00-05:00' }, end: { dateTime: '2026-11-15T11:00:00-05:00' } },
    ],
  };

  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    this.requests.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (url.href === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(String(init?.body));
      if (p.get('client_id') !== CLIENT_ID || p.get('client_secret') !== 'shh-secret-123') return reply(401, { error: 'invalid_client' });
      if (p.get('grant_type') === 'authorization_code') {
        const ok = p.get('code') === 'good-code' && createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url') === this.challenge;
        return ok ? reply(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3599 }) : reply(400, { error: 'invalid_grant' });
      }
      if (this.revoked || p.get('refresh_token') !== 'rt-1') return reply(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return reply(200, { access_token: 'at-2', expires_in: 3599 });
    }

    if (!['Bearer at-1', 'Bearer at-2'].includes(new Headers(init?.headers).get('authorization') ?? '')) {
      return reply(401, { error: { message: 'Invalid Credentials' } });
    }
    if (url.pathname === '/calendar/v3/users/me/calendarList') {
      // Two pages, to exercise paging.
      return url.searchParams.get('pageToken')
        ? reply(200, { items: this.calendars.slice(2) })
        : reply(200, { items: this.calendars.slice(0, 2), nextPageToken: 'p2' });
    }
    const m = url.pathname.match(/^\/calendar\/v3\/calendars\/(.+)\/events$/);
    if (m) return reply(200, { items: this.events[decodeURIComponent(m[1])] ?? [] });
    return reply(404, { error: { message: 'Not found' } });
  }) as typeof fetch;
}

let store: Store;
let google: FakeGoogle;
let sync: CalendarSync;
let app: ReturnType<typeof createApp>;

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const board = async () => (await call('GET', '/api/board')).body as unknown as Board;

/** Runs the sign-in the way a person would: start, then paste the failed redirect. */
async function signIn(personId = 'troy', code = 'good-code') {
  const { body } = await call('POST', '/api/google/start', { personId });
  const url = new URL(String(body.url));
  google.challenge = url.searchParams.get('code_challenge')!;
  return call('POST', '/api/google/finish', { response: `http://127.0.0.1:8710/?state=${url.searchParams.get('state')}&code=${code}&scope=x` });
}

beforeEach(() => {
  store = new Store(':memory:');
  process.env.DEMO_DATA = '0';
  seedIfEmpty(store, NOW);
  delete process.env.DEMO_DATA;
  google = new FakeGoogle();
  sync = new CalendarSync(store, new Secrets(randomBytes(32)), { googleFetch: google.fetch, now: () => NOW });
  app = createApp({ store, now: () => NOW, weather: false, sync });
});

describe('Google setup', () => {
  it('checks the client ID and never returns the secret', async () => {
    expect((await call('PUT', '/api/google/config', { clientId: 'nope', clientSecret: 'shh-secret-123' })).status).toBe(400);
    expect((await call('PUT', '/api/google/config', { clientId: CLIENT_ID, clientSecret: 'shh-secret-123' })).status).toBe(200);
    const { body } = await call('GET', '/api/google/config');
    expect(body).toEqual({ configured: true, clientId: CLIENT_ID });
    expect(store.getMeta('googleClient')).not.toContain('shh-secret');
  });

  it('asks for setup before sign-in', async () => {
    const res = await call('POST', '/api/google/start', { personId: 'troy' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/client ID and secret/);
  });
});

describe('Google sign-in and sync', () => {
  beforeEach(async () => {
    await call('PUT', '/api/google/config', { clientId: CLIENT_ID, clientSecret: 'shh-secret-123' });
  });

  it('builds a sign-in address for offline, read-only access with PKCE', async () => {
    const { body } = await call('POST', '/api/google/start', { personId: 'troy' });
    const q = new URL(String(body.url)).searchParams;
    expect(q.get('client_id')).toBe(CLIENT_ID);
    expect(q.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly');
    expect(q.get('redirect_uri')).toBe('http://127.0.0.1:8710/');
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('code_challenge_method')).toBe('S256');
  });

  it('connects the account, picks sensible calendars and syncs events', async () => {
    const res = await signIn();
    expect(res.status).toBe(201);
    const [account] = store.accounts();
    expect(account).toMatchObject({ kind: 'google', username: 'troy@gmail.com', personId: 'troy', lastError: null });
    expect(store.account(account.id)!.passwordEnc).not.toContain('rt-1');

    const cals = store.calendarSources().map(c => [c.name, c.enabled, c.personId]);
    expect(cals).toEqual([
      ['Family Sports', true, null],
      ['Holidays in United States', false, 'troy'],
      ['troy@gmail.com', true, 'troy'],
    ]);

    const events = (await board()).events.map(e => [e.title, e.start, e.personIds]);
    expect(events).toEqual(expect.arrayContaining([
      ['Haircut', '2026-11-13T14:00:00.000Z', ['troy']],
      ['Lincoln tournament', '2026-11-14', ['lincoln']],
      ['Everly swim meet', '2026-11-15T13:00:00.000Z', ['everly']],
    ]));
    expect(events.map(e => e[0])).not.toContain('Cancelled thing');
    expect(events.map(e => e[0])).not.toContain('Declined meeting');
  });

  it('shows an event that is on both Google and iCloud once', async () => {
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:x', 'BEGIN:VEVENT', 'UID:shared-dentist', 'SUMMARY:Dentist',
      'DTSTART:20261113T130000Z', 'DTEND:20261113T140000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const connect: Connect = async () => ({
      listCalendars: async () => [{ url: '/alexia/home/', name: 'Home', color: '', ctag: '1' }],
      fetchIcs: async () => [ics],
    } satisfies CalDavClient);
    sync = new CalendarSync(store, new Secrets(randomBytes(32)), { googleFetch: google.fetch, connect, now: () => NOW });
    app = createApp({ store, now: () => NOW, weather: false, sync });
    await call('PUT', '/api/google/config', { clientId: CLIENT_ID, clientSecret: 'shh-secret-123' });
    await signIn('troy');
    await sync.addAccount({ personId: 'alexia', username: 'alexia@icloud.com', password: 'abcd-efgh-ijkl-mnop' });

    const dentist = (await board()).events.filter(e => e.title === 'Dentist');
    expect(dentist).toHaveLength(1);
    expect(dentist[0].personIds.sort()).toEqual(['alexia', 'troy']);
  });

  it('explains a wrong paste, a reused sign-in and a cancelled one', async () => {
    expect((await call('POST', '/api/google/finish', { response: 'hello' })).body.error).toMatch(/whole address/);
    expect((await call('POST', '/api/google/finish', { response: 'http://127.0.0.1:8710/?state=old&code=x' })).body.error).toMatch(/expired or was already used/);
    expect((await call('POST', '/api/google/finish', { response: 'http://127.0.0.1:8710/?error=access_denied&state=x' })).body.error).toMatch(/cancelled/);
    const res = await signIn('troy');
    expect(res.status).toBe(201);
    // The same pasted address can't be used twice.
    expect(store.accounts()).toHaveLength(1);
  });

  it('reports a revoked sign-in on the board', async () => {
    await signIn();
    google.revoked = true;
    await sync.syncAll({ force: true });
    const problems = (await board()).syncProblems;
    expect(problems).toEqual([{ name: 'Troy’s Google', message: expect.stringMatching(/expired or was removed/) }]);
  });
});
