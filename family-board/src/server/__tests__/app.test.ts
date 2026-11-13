import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../store';
import { seedIfEmpty } from '../seed';
import { createApp } from '../app';
import type { Board } from '../../shared/types';

// Friday, Nov 13 2026, 2:40 PM Eastern.
const NOW = new Date('2026-11-13T19:40:00Z');

let store: Store;
let app: ReturnType<typeof createApp>;

const call = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const board = async (q = '') => (await (await call('GET', `/api/board${q}`)).json()) as Board;

beforeEach(() => {
  store = new Store(':memory:');
  seedIfEmpty(store, NOW);
  app = createApp({ store, now: () => NOW, weather: false });
});

describe('first run', () => {
  it('creates the family, the school calendar and sample data', async () => {
    const b = await board();
    expect(b.today).toBe('2026-11-13');
    expect(b.from).toBe('2026-11-09');
    expect(b.people.map(p => p.name)).toEqual(['Troy', 'Alexia', 'Lincoln', 'Everly']);
    expect(b.schoolYear?.lastStudentDay).toBe('2027-05-27');
    expect(b.hasDemoData).toBe(true);
    expect(b.trips[0]).toMatchObject({ city: 'Denver', startsOn: '2026-11-12', endsOn: '2026-11-15' });
  });

  it('answers the Kids view question for today', async () => {
    const b = await board();
    const chess = b.activities.find(a => a.name === 'Chess club')!;
    const answer = b.answers.find(a => a.activityId === chess.id)!;
    expect(answer.happening).toBe(false);
    expect(answer.next?.date).toBe('2026-11-17');
  });

  it('removes sample data but keeps the family and school calendar', async () => {
    await call('POST', '/api/demo/clear');
    const b = await board();
    expect(b.hasDemoData).toBe(false);
    expect(b.activities).toHaveLength(0);
    expect(b.people).toHaveLength(4);
    expect(store.schoolDays().length).toBeGreaterThan(20);
  });
});

describe('editing', () => {
  it('changes a person’s color and rejects a bad one', async () => {
    expect((await call('PUT', '/api/people/everly', { color: '#6B53C7' })).status).toBe(200);
    expect(store.person('everly')?.color).toBe('#6B53C7');
    const bad = await call('PUT', '/api/people/everly', { color: 'purple' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/#2F6FB5/);
  });

  it('adds an activity and answers for it', async () => {
    const res = await call('POST', '/api/activities', {
      personId: 'everly', name: 'Piano', icon: '🎹', rrule: 'FREQ=WEEKLY;BYDAY=FR',
      startTime: '17:00', endTime: '17:30', skipOn: [], startsOn: '2026-09-01',
    });
    expect(res.status).toBe(201);
    const b = await board();
    const piano = b.activities.find(a => a.name === 'Piano')!;
    expect(b.answers.find(a => a.activityId === piano.id)?.happening).toBe(true);
  });

  it('explains what is wrong with an activity', async () => {
    const res = await call('POST', '/api/activities', {
      personId: 'everly', name: 'Piano', rrule: 'FREQ=WEEKLY;BYDAY=FR',
      startTime: '17:30', endTime: '17:00', startsOn: '2026-09-01',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('The end time must be after the start time.');
  });

  it('marks a snow day, which skips school activities, and removes it', async () => {
    await call('POST', '/api/school-days', { date: '2026-11-17' });
    let b = await board('?from=2026-11-16&to=2026-11-22');
    const chess = b.activities.find(a => a.name === 'Chess club')!;
    expect(b.occurrences.find(o => o.activityId === chess.id && o.date === '2026-11-17'))
      .toMatchObject({ status: 'skipped', reason: 'Snow day' });
    await call('DELETE', '/api/school-days/2026-11-17');
    b = await board('?from=2026-11-16&to=2026-11-22');
    expect(b.occurrences.find(o => o.activityId === chess.id && o.date === '2026-11-17')?.status).toBe('on');
  });

  it('won’t delete a district school day', async () => {
    expect((await call('DELETE', '/api/school-days/2026-11-25')).status).toBe(404);
  });

  it('adds a trip with a valid time zone only', async () => {
    const trip = { personId: 'troy', city: 'Chicago', tz: 'America/Chicago', startsOn: '2026-12-01', endsOn: '2026-12-03' };
    expect((await call('POST', '/api/trips', trip)).status).toBe(201);
    expect((await call('POST', '/api/trips', { ...trip, tz: 'Mars/Base' })).status).toBe(400);
  });
});
