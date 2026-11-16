import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../store';
import { seedIfEmpty } from '../seed';
import { createApp } from '../app';
import type { Board, ListItem } from '../../shared/types';

// Friday, Nov 13 2026, 2:40 PM Eastern.
let now = new Date('2026-11-13T19:40:00Z');
let store: Store;
let app: ReturnType<typeof createApp>;

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const board = async (q = '') => (await call('GET', `/api/board${q}`)).body as unknown as Board;

beforeEach(() => {
  now = new Date('2026-11-13T19:40:00Z');
  store = new Store(':memory:');
  process.env.DEMO_DATA = '0';
  seedIfEmpty(store, now);
  delete process.env.DEMO_DATA;
  app = createApp({ store, now: () => now, weather: false });
});

describe('lists', () => {
  it('starts with Groceries and Family to-do', async () => {
    expect((await board()).lists.map(l => [l.id, l.name, l.kind])).toEqual([
      ['groceries', 'Groceries', 'grocery'], ['family', 'Family to-do', 'todo'],
    ]);
  });

  it('adds items, and doesn’t add the same open item twice', async () => {
    expect((await call('POST', '/api/lists/groceries/items', { text: 'Milk' })).status).toBe(201);
    const again = await call('POST', '/api/lists/groceries/items', { text: ' milk ' });
    expect(again.status).toBe(200);
    expect(again.body.added).toBe(false);
    expect((await board()).items.map(i => i.text)).toEqual(['Milk']);
    expect((await call('POST', '/api/lists/groceries/items', { text: '  ' })).status).toBe(400);
    expect((await call('POST', '/api/lists/nope/items', { text: 'x' })).status).toBe(400);
  });

  it('checks items off, keeps them faded for two days, and clears them', async () => {
    const { body } = await call('POST', '/api/lists/groceries/items', { text: 'Eggs' });
    const id = (body.item as ListItem).id;
    await call('PUT', `/api/items/${id}`, { done: true });
    let item = (await board()).items.find(i => i.id === id)!;
    expect(item).toMatchObject({ done: true, doneAt: now.toISOString() });
    // Unchecking clears the time; checking again sets it.
    await call('PUT', `/api/items/${id}`, { done: false });
    expect((await board()).items.find(i => i.id === id)?.doneAt).toBeNull();
    await call('PUT', `/api/items/${id}`, { done: true });
    now = new Date('2026-11-16T12:00:00Z');
    expect((await board()).items.find(i => i.id === id)).toBeUndefined();

    await call('POST', '/api/lists/groceries/items', { text: 'Bread' });
    const bread = (await board()).items.find(i => i.text === 'Bread')!;
    await call('PUT', `/api/items/${bread.id}`, { done: true });
    expect((await call('POST', '/api/lists/groceries/clear-done')).body.removed).toBe(2);
  });

  it('keeps who a to-do is for and when it’s due', async () => {
    await call('POST', '/api/lists/family/items', { text: 'Return library books', personId: 'everly', dueOn: '2026-11-13' });
    expect((await board()).items[0]).toMatchObject({ personId: 'everly', dueOn: '2026-11-13', done: false });
    expect((await call('POST', '/api/lists/family/items', { text: 'x', dueOn: 'friday' })).status).toBe(400);
  });
});

describe('dinners', () => {
  it('plans a dinner, saves new ones as meals, and links existing ones', async () => {
    await call('PUT', '/api/dinners/2026-11-13', { title: 'Tacos', cookId: 'alexia' });
    await call('PUT', '/api/dinners/2026-11-14', { title: 'tacos' });
    const b = await board();
    expect(b.meals.map(m => m.name)).toEqual(['Tacos']);
    expect(b.dinners).toEqual([
      { date: '2026-11-13', mealId: b.meals[0].id, title: 'Tacos', cookId: 'alexia', note: '' },
      { date: '2026-11-14', mealId: b.meals[0].id, title: 'Tacos', cookId: null, note: '' },
    ]);
    await call('PUT', '/api/dinners/2026-11-14', { title: '' });
    expect((await board()).dinners).toHaveLength(1);
  });

  it('copies last week into this week’s empty days', async () => {
    await call('PUT', '/api/dinners/2026-11-02', { title: 'Spaghetti' });
    await call('PUT', '/api/dinners/2026-11-03', { title: 'Soup' });
    await call('PUT', '/api/dinners/2026-11-10', { title: 'Leftovers' });
    const res = await call('POST', '/api/dinners/copy-week', { from: '2026-11-09' });
    expect(res.body.copied).toBe(1);
    expect((await board()).dinners.map(d => [d.date, d.title])).toEqual([['2026-11-09', 'Spaghetti'], ['2026-11-10', 'Leftovers']]);
  });

  it('adds the week’s ingredients to Groceries, skipping ones already there', async () => {
    await call('PUT', '/api/dinners/2026-11-13', { title: 'Tacos' });
    await call('PUT', '/api/dinners/2026-11-14', { title: 'Pizza' });
    const tacos = (await board()).meals.find(m => m.name === 'Tacos')!;
    await call('PUT', `/api/meals/${tacos.id}`, { ingredients: 'Tortillas\nGround beef\n\nCheese' });
    await call('POST', '/api/lists/groceries/items', { text: 'cheese' });
    const res = await call('POST', '/api/dinners/groceries', { from: '2026-11-09', to: '2026-11-15' });
    expect(res.body).toEqual({ added: ['Tortillas', 'Ground beef'], missing: ['Pizza'] });
    expect((await board()).items.map(i => i.text)).toEqual(['cheese', 'Tortillas', 'Ground beef']);
  });

  it('renames planned dinners with their meal, and keeps them when the meal is deleted', async () => {
    await call('PUT', '/api/dinners/2026-11-13', { title: 'Tacos' });
    const tacos = (await board()).meals[0];
    await call('PUT', `/api/meals/${tacos.id}`, { name: 'Taco night' });
    expect((await board()).dinners[0].title).toBe('Taco night');
    await call('DELETE', `/api/meals/${tacos.id}`);
    expect((await board()).dinners[0]).toMatchObject({ title: 'Taco night', mealId: null });
  });

  it('only returns dinners in the requested range', async () => {
    await call('PUT', '/api/dinners/2026-11-20', { title: 'Chili' });
    expect((await board()).dinners).toHaveLength(0);
    expect((await board('?from=2026-11-16&to=2026-11-22')).dinners).toHaveLength(1);
  });
});

describe('events added by hand', () => {
  it('adds an all-day event on several dates for one kid', async () => {
    const res = await call('POST', '/api/manual-events', {
      personId: 'lincoln', title: 'Buys lunch', dates: ['2026-11-17', '2026-11-13', '2026-11-13'],
    });
    expect(res.status).toBe(201);
    expect((res.body.events as unknown[]).length).toBe(2);
    const today = (await board()).events.filter(e => e.title === 'Buys lunch');
    expect(today).toEqual([expect.objectContaining({ allDay: true, start: '2026-11-13', end: '2026-11-14', personIds: ['lincoln'] })]);
    const next = (await board('?from=2026-11-16&to=2026-11-22')).events.filter(e => e.title === 'Buys lunch');
    expect(next.map(e => e.start)).toEqual(['2026-11-17']);
  });

  it('adds a timed event, an hour long unless an end time is given', async () => {
    await call('POST', '/api/manual-events', { personId: 'everly', title: 'Field trip pickup', dates: ['2026-11-13'], startTime: '14:30' });
    await call('POST', '/api/manual-events', { personId: 'everyone', title: 'Parent night', dates: ['2026-11-13'], startTime: '18:00', endTime: '19:30', location: 'Gym' });
    const events = (await board()).events;
    // 2:30 PM Eastern is 7:30 PM UTC.
    expect(events.find(e => e.title === 'Field trip pickup')).toMatchObject({
      allDay: false, start: '2026-11-13T19:30:00.000Z', end: '2026-11-13T20:30:00.000Z', personIds: ['everly'],
    });
    expect(events.find(e => e.title === 'Parent night')).toMatchObject({ end: '2026-11-14T00:30:00.000Z', personIds: [], location: 'Gym' });
  });

  it('lists upcoming events and removes one date', async () => {
    await call('POST', '/api/manual-events', { personId: 'lincoln', title: 'Buys lunch', dates: ['2026-11-01', '2026-11-13', '2026-11-17'] });
    const { body } = await call('GET', '/api/manual-events');
    const upcoming = body.events as Array<{ id: string; start: string }>;
    expect(upcoming.map(e => e.start)).toEqual(['2026-11-13', '2026-11-17']);
    expect((await call('DELETE', `/api/manual-events/${upcoming[0].id}`)).status).toBe(200);
    expect((await board()).events.some(e => e.title === 'Buys lunch')).toBe(false);
    expect((await call('DELETE', `/api/manual-events/${upcoming[0].id}`)).status).toBe(404);
  });

  it('explains what’s missing or wrong', async () => {
    const err = async (b: object) => (await call('POST', '/api/manual-events', { personId: 'lincoln', title: 'x', dates: ['2026-11-13'], ...b })).body.error;
    expect(await err({ personId: 'nobody' })).toMatch(/who it’s for/);
    expect(await err({ title: ' ' })).toMatch(/Describe/);
    expect(await err({ dates: [] })).toMatch(/at least one date/);
    expect(await err({ startTime: '25:00' })).toMatch(/Times look like/);
    expect(await err({ endTime: '12:00' })).toMatch(/start time before/);
    expect(await err({ startTime: '12:00', endTime: '11:00' })).toMatch(/after the start/);
  });

  it('survives removing sample data', async () => {
    await call('POST', '/api/manual-events', { personId: 'lincoln', title: 'Buys lunch', dates: ['2026-11-13'] });
    await call('POST', '/api/demo/clear');
    expect((await board()).events.some(e => e.title === 'Buys lunch')).toBe(true);
  });
});

describe('repeating events added by hand', () => {
  const lunch = { personId: 'lincoln', title: 'Buys lunch', rrule: 'FREQ=WEEKLY;BYDAY=TU,TH', startsOn: '2026-11-09' };
  const titled = (b: Board, title: string) => b.events.filter(e => e.title === title).map(e => e.start).sort();

  it('repeats weekly from its start date, all day', async () => {
    expect((await call('POST', '/api/event-series', lunch)).status).toBe(201);
    const week = await board('?from=2026-11-09&to=2026-11-15');
    expect(titled(week, 'Buys lunch')).toEqual(['2026-11-10', '2026-11-12']);
    expect(week.events.find(e => e.title === 'Buys lunch')).toMatchObject({ allDay: true, personIds: ['lincoln'], calendarId: 'manual' });
  });

  it('skips days with no school when asked', async () => {
    await call('POST', '/api/event-series', { ...lunch, skipNoSchool: true });
    // Thanksgiving week: Tue 24 is a school day, Thu 26 is not.
    expect(titled(await board('?from=2026-11-23&to=2026-11-29'), 'Buys lunch')).toEqual(['2026-11-24']);
  });

  it('keeps no-school days when not asked to skip them', async () => {
    await call('POST', '/api/event-series', lunch);
    expect(titled(await board('?from=2026-11-23&to=2026-11-29'), 'Buys lunch')).toEqual(['2026-11-24', '2026-11-26']);
  });

  it('skips single dates, and can bring them back', async () => {
    const id = ((await call('POST', '/api/event-series', lunch)).body as { id: string }).id;
    await call('PUT', `/api/event-series/${id}`, { skipDates: ['2026-11-12'] });
    expect(titled(await board('?from=2026-11-09&to=2026-11-15'), 'Buys lunch')).toEqual(['2026-11-10']);
    await call('PUT', `/api/event-series/${id}`, { skipDates: [] });
    expect(titled(await board('?from=2026-11-09&to=2026-11-15'), 'Buys lunch')).toEqual(['2026-11-10', '2026-11-12']);
  });

  it('stops at its end date, and handles times and monthly rules', async () => {
    await call('POST', '/api/event-series', { ...lunch, endsOn: '2026-11-10' });
    expect(titled(await board('?from=2026-11-09&to=2026-11-15'), 'Buys lunch')).toEqual(['2026-11-10']);
    await call('POST', '/api/event-series', {
      personId: 'everyone', title: 'PTA meeting', rrule: 'FREQ=MONTHLY;BYDAY=1TU', startsOn: '2026-09-01', startTime: '18:30', endTime: '20:00',
    });
    const dec = (await board('?from=2026-11-30&to=2026-12-06')).events.find(e => e.title === 'PTA meeting');
    // First Tuesday of December, 6:30 PM Eastern = 11:30 PM UTC.
    expect(dec).toMatchObject({ allDay: false, start: '2026-12-01T23:30:00.000Z', end: '2026-12-02T01:00:00.000Z', personIds: [] });
  });

  it('is listed in Settings and removed in one step', async () => {
    const id = ((await call('POST', '/api/event-series', lunch)).body as { id: string }).id;
    expect(((await call('GET', '/api/manual-events')).body.series as unknown[]).length).toBe(1);
    expect((await call('DELETE', `/api/event-series/${id}`)).status).toBe(200);
    expect(titled(await board(), 'Buys lunch')).toEqual([]);
  });

  it('explains what’s missing or wrong', async () => {
    const err = async (b: object) => (await call('POST', '/api/event-series', { ...lunch, ...b })).body.error;
    expect(await err({ rrule: 'nonsense' })).toMatch(/how it repeats/);
    expect(await err({ rrule: 'FREQ=WEEKLY;BYDAY=XX' })).toMatch(/which days/);
    expect(await err({ endsOn: '2026-11-01' })).toMatch(/on or after the start/);
    expect(await err({ startsOn: '' })).toMatch(/when it starts/);
    expect(await err({ startTime: '12:00', endTime: '11:00' })).toMatch(/after the start time/);
  });
});
