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
