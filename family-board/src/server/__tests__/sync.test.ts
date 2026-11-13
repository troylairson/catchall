import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { Store } from '../store';
import { seedIfEmpty } from '../seed';
import { Secrets } from '../secrets';
import { CalendarSync } from '../sync';
import { createApp } from '../app';
import type { CalDavClient, Connect, RemoteCalendar } from '../caldav';
import type { Board } from '../../shared/types';
import { assignPeople, mergeDuplicates, mentions } from '../../shared/assign';

const NOW = new Date('2026-11-13T19:40:00Z');

const ics = (uid: string, title: string, start: string, end: string) => [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test', 'BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${title}`,
  `DTSTART;TZID=America/New_York:${start}`, `DTEND;TZID=America/New_York:${end}`, 'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');

/** A fake iCloud: two accounts, each with calendars holding ICS files. */
class FakeICloud {
  password = 'abcd-efgh-ijkl-mnop';
  fetches = 0;
  down = false;
  calendars: Record<string, Array<RemoteCalendar & { files: string[] }>> = {
    'troy@example.com': [
      { url: '/troy/home/', name: 'Home', color: '#1BADF8', ctag: '1', files: [ics('t1', 'Dentist', '20261113T080000', '20261113T090000')] },
      { url: '/troy/family/', name: 'Family', color: '#FF9500', ctag: '1', files: [
        ics('f1', 'Lincoln basketball game', '20261113T180000', '20261113T193000'),
        ics('f2', 'Haircuts for Lincoln and Everly', '20261111T160000', '20261111T164500'),
        ics('f3', 'Grandma visits', '20261115T120000', '20261115T150000'),
        // Also on Troy's own calendar, as an invitation would be.
        ics('t1', 'Dentist', '20261113T080000', '20261113T090000'),
      ] },
    ],
  };
  connect: Connect = async (_url, username, password) => {
    if (this.down) throw new Error('fetch failed');
    if (password !== this.password) throw new Error('Invalid credentials');
    const cals = this.calendars[username] ?? [];
    const client: CalDavClient = {
      listCalendars: async () => cals.map(({ files: _f, ...c }) => c),
      fetchIcs: async url => { this.fetches++; return cals.find(c => c.url === url)?.files ?? []; },
    };
    return client;
  };
}

let store: Store;
let cloud: FakeICloud;
let sync: CalendarSync;

beforeEach(() => {
  store = new Store(':memory:');
  process.env.DEMO_DATA = '0';
  seedIfEmpty(store, NOW);
  delete process.env.DEMO_DATA;
  cloud = new FakeICloud();
  sync = new CalendarSync(store, new Secrets(randomBytes(32)), { connect: cloud.connect, now: () => NOW });
});

describe('connecting an account', () => {
  it('lowercases an app-specific password a keyboard capitalized', async () => {
    await sync.addAccount({ personId: 'troy', username: 'troy@example.com', password: 'Abcd-efgh-ijkl-mnop' });
    expect(store.accounts()).toHaveLength(1);
  });

  it('rejects a wrong password with advice', async () => {
    await expect(sync.addAccount({ personId: 'troy', username: 'troy@example.com', password: 'wrong-password' }))
      .rejects.toThrow(/app-specific password/);
    expect(store.accounts()).toHaveLength(0);
  });

  it('saves the account, encrypts the password and finds its calendars', async () => {
    await sync.addAccount({ personId: 'troy', username: 'troy@example.com', password: ' abcd-efgh-ijkl-mnop ' });
    const [account] = store.accounts();
    expect(account).toMatchObject({ personId: 'troy', username: 'troy@example.com', lastError: null });
    expect(store.account(account.id)!.passwordEnc).not.toContain('abcd');
    const cals = store.calendarSources();
    expect(cals.map(c => [c.name, c.personId])).toEqual([['Family', null], ['Home', 'troy']]);
  });
});

describe('syncing', () => {
  beforeEach(async () => {
    await sync.addAccount({ personId: 'troy', username: 'troy@example.com', password: cloud.password });
  });

  const board = async (): Promise<Board> =>
    (await createApp({ store, now: () => NOW, weather: false }).request('/api/board')).json();

  it('puts family-calendar events in the columns of the people they name', async () => {
    const events = (await board()).events;
    const by = (title: string) => events.find(e => e.title === title)?.personIds;
    expect(by('Lincoln basketball game')).toEqual(['lincoln']);
    expect(by('Haircuts for Lincoln and Everly')).toEqual(['lincoln', 'everly']);
    expect(by('Grandma visits')).toEqual([]);
  });

  it('shows an event on two calendars once', async () => {
    const dentist = (await board()).events.filter(e => e.title === 'Dentist');
    expect(dentist).toHaveLength(1);
    expect(dentist[0].personIds).toEqual(['troy']);
  });

  it('skips unchanged calendars and picks up changes', async () => {
    const before = cloud.fetches;
    await sync.syncAll();
    expect(cloud.fetches).toBe(before);
    const home = cloud.calendars['troy@example.com'][0];
    home.files.push(ics('t2', 'Book club', '20261114T190000', '20261114T203000'));
    home.ctag = '2';
    await sync.syncAll();
    expect(cloud.fetches).toBe(before + 1);
    expect((await board()).events.some(e => e.title === 'Book club')).toBe(true);
  });

  it('hides a turned-off calendar and moves a calendar to another person', async () => {
    const app = createApp({ store, now: () => NOW, weather: false, sync });
    const family = store.calendarSources().find(c => c.name === 'Family')!;
    await app.request(`/api/calendars/${family.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
    expect((await board()).events.some(e => e.title === 'Grandma visits')).toBe(false);

    const home = store.calendarSources().find(c => c.name === 'Home')!;
    await app.request(`/api/calendars/${home.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personId: 'alexia' }) });
    expect((await board()).events.find(e => e.title === 'Dentist')?.personIds).toEqual(['alexia']);
  });

  it('reports a problem when iCloud can’t be reached, and recovers', async () => {
    cloud.down = true;
    await sync.syncAll({ force: true });
    let problems = (await board()).syncProblems;
    expect(problems).toEqual([{ name: 'Troy’s iCloud', message: expect.stringMatching(/Couldn’t reach iCloud/) }]);
    // Events from the last good sync stay visible.
    expect((await board()).events.length).toBeGreaterThan(0);
    cloud.down = false;
    await sync.syncAll();
    problems = (await board()).syncProblems;
    expect(problems).toEqual([]);
  });

  it('removes calendars deleted in iCloud, and everything when the account is removed', async () => {
    cloud.calendars['troy@example.com'].pop();
    await sync.syncAll({ force: true });
    expect(store.calendarSources().map(c => c.name)).toEqual(['Home']);
    store.deleteAccount(store.accounts()[0].id);
    expect(store.calendarSources()).toHaveLength(0);
    expect((await board()).events).toHaveLength(0);
  });

  it('puts a kid’s event from a parent’s personal calendar in the kid’s column', async () => {
    const home = cloud.calendars['troy@example.com'][0];
    home.files.push(ics('t3', 'Lincoln Chess', '20261112T151500', '20261112T163000'));
    home.ctag = '2';
    await sync.syncAll();
    expect((await board()).events.find(e => e.title === 'Lincoln Chess')?.personIds).toEqual(['lincoln']);
    // Titles that name no one still go to the calendar's owner.
    expect((await board()).events.find(e => e.title === 'Dentist')?.personIds).toEqual(['troy']);
  });

  it('re-assigns events when a keyword is added', async () => {
    const app = createApp({ store, now: () => NOW, weather: false, sync });
    await app.request('/api/people/everly', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keywords: ['grandma'] }) });
    expect((await board()).events.find(e => e.title === 'Grandma visits')?.personIds).toEqual(['everly']);
  });
});

describe('upgrading an existing database', () => {
  it('adds the calendar tables to a database from the first release', () => {
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const path = `/tmp/fb-migrate-${Date.now()}.db`;
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE event (id TEXT PRIMARY KEY, calendarId TEXT NOT NULL, title TEXT NOT NULL, allDay INTEGER NOT NULL,
      start TEXT NOT NULL, "end" TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      personIds TEXT NOT NULL DEFAULT '[]', demo INTEGER NOT NULL DEFAULT 0);
      INSERT INTO event VALUES ('e1', 'sample', 'Old event', 0, '2026-11-13T15:00:00Z', '2026-11-13T16:00:00Z', '', '', '[]', 1);`);
    old.close();
    const upgraded = new Store(path);
    expect(upgraded.accounts()).toEqual([]);
    expect(upgraded.events('2026-11-13', '2026-11-13')[0]).toMatchObject({ title: 'Old event', externalUid: '' });
  });
});

describe('assigning people', () => {
  const people = [
    { id: 'lincoln', name: 'Lincoln', color: '#000000', emoji: '', role: 'kid' as const, sortOrder: 0, keywords: ['🏀'] },
    { id: 'everly', name: 'Everly', color: '#000000', emoji: '', role: 'kid' as const, sortOrder: 1, keywords: [] },
  ];
  it('matches whole names, possessives and keywords, not parts of words', () => {
    expect(mentions('Lincoln’s dentist', people[0])).toBe(true);
    expect(mentions("lincoln's dentist", people[0])).toBe(true);
    expect(mentions('🏀 practice', people[0])).toBe(true);
    expect(mentions('Lincolnshire trip', people[0])).toBe(false);
    expect(assignPeople('Lincoln and Everly: haircuts', null, people)).toEqual(['lincoln', 'everly']);
    expect(assignPeople('Anything', 'troy', people)).toEqual(['troy']);
    // A name in the title wins, even on someone's personal calendar.
    expect(assignPeople('Lincoln Chess', 'troy', people)).toEqual(['lincoln']);
    expect(assignPeople('Grandma visits', null, people)).toEqual([]);
  });

  it('merges copies by title and start when UIDs differ', () => {
    const base = { calendarId: 'a', allDay: false, start: '2026-11-13T15:00:00.000Z', end: '2026-11-13T16:00:00.000Z', location: '', notes: '' };
    const merged = mergeDuplicates([
      { ...base, id: '1', title: 'Parent conference', personIds: ['troy'], externalUid: 'x' },
      { ...base, id: '2', title: 'Parent Conference', personIds: ['alexia'], externalUid: 'y' },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].personIds).toEqual(['troy', 'alexia']);
  });
});
