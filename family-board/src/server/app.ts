import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Store } from './store';
import { buildBoard } from './board';
import { loadDemoData } from './seed';
import { getWeather } from './weather';
import { addDays } from '../shared/dates';
import type { CalendarSync } from './sync';
import { isHexColor } from '../shared/colors';
import { EVERYONE, type Activity, type ActivityException, type Settings, type Trip } from '../shared/types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

class BadRequest extends Error {}

function req(cond: unknown, message: string): asserts cond {
  if (!cond) throw new BadRequest(message);
}

function validTz(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Listeners for "something changed", so open screens refresh right away. */
export class ChangeBus {
  private listeners = new Set<() => void>();
  on(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(): void { for (const fn of this.listeners) fn(); }
}

export interface AppOptions {
  store: Store;
  bus?: ChangeBus;
  now?: () => Date;
  weather?: boolean;
  sync?: CalendarSync;
}

export function createApp({ store, bus = new ChangeBus(), now = () => new Date(), weather = true, sync }: AppOptions) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
    console.error(err);
    return c.json({ error: 'Something went wrong on the server.' }, 500);
  });

  const changed = <T>(c: Context, body: T, status: 200 | 201 = 200) => {
    bus.emit();
    return c.json(body as object, status);
  };

  app.get('/api/health', c => c.json({ ok: true }));

  app.get('/api/board', async c => {
    const from = c.req.query('from');
    const to = c.req.query('to');
    req(!from || DATE.test(from), 'from must be a date like 2026-11-13.');
    req(!to || DATE.test(to), 'to must be a date like 2026-11-13.');
    req(!from || !to || from <= to, 'from must be on or before to.');
    const w = weather ? await getWeather(store.settings()) : null;
    return c.json(buildBoard(store, { from, to, now: now(), weather: w }));
  });

  // People
  app.put('/api/people/:id', async c => {
    const p = store.person(c.req.param('id'));
    if (!p) return c.json({ error: 'No such person.' }, 404);
    const body = await c.req.json<Partial<typeof p>>();
    const next = { ...p };
    if (body.name !== undefined) { req(String(body.name).trim(), 'Name can’t be empty.'); next.name = String(body.name).trim(); }
    if (body.color !== undefined) { req(isHexColor(body.color), 'Color must look like #2F6FB5.'); next.color = body.color; }
    if (body.emoji !== undefined) next.emoji = String(body.emoji).trim().slice(0, 8);
    if (body.keywords !== undefined) {
      req(Array.isArray(body.keywords), 'Keywords must be a list.');
      next.keywords = body.keywords.map(k => String(k).trim()).filter(Boolean);
    }
    store.savePerson(next);
    sync?.reassign();
    return changed(c, next);
  });

  // Activities
  const checkActivity = (a: Partial<Activity>): Omit<Activity, 'id'> => {
    req(a.personId && store.person(a.personId), 'Choose who the activity is for.');
    req(a.name && String(a.name).trim(), 'Give the activity a name.');
    req(a.rrule && /^FREQ=/.test(a.rrule), 'Choose which days it happens.');
    req(a.startTime && TIME.test(a.startTime) && a.endTime && TIME.test(a.endTime), 'Times must look like 15:15.');
    req(a.startTime < a.endTime, 'The end time must be after the start time.');
    req(a.startsOn && DATE.test(a.startsOn), 'Choose a start date.');
    req(!a.endsOn || (DATE.test(a.endsOn) && a.endsOn >= a.startsOn), 'The end date must be after the start date.');
    const skipOn = (a.skipOn ?? []).filter(k => k === 'no_school' || k === 'early_release');
    return {
      personId: a.personId, name: String(a.name).trim(), icon: a.icon ?? '', rrule: a.rrule,
      startTime: a.startTime, endTime: a.endTime, location: a.location ?? '', notes: a.notes ?? '',
      skipOn, startsOn: a.startsOn, endsOn: a.endsOn || null, demo: false,
    };
  };

  app.post('/api/activities', async c => changed(c, store.saveActivity(checkActivity(await c.req.json())), 201));

  app.put('/api/activities/:id', async c => {
    const existing = store.activity(c.req.param('id'));
    if (!existing) return c.json({ error: 'No such activity.' }, 404);
    const body = await c.req.json<Partial<Activity>>();
    return changed(c, store.saveActivity({ ...checkActivity({ ...existing, ...body }), id: existing.id }));
  });

  app.delete('/api/activities/:id', c => {
    if (!store.deleteActivity(c.req.param('id'))) return c.json({ error: 'No such activity.' }, 404);
    return changed(c, { ok: true });
  });

  // One-off changes to an activity
  app.post('/api/exceptions', async c => {
    const e = await c.req.json<Partial<ActivityException>>();
    req(e.activityId && store.activity(e.activityId), 'No such activity.');
    req(e.date && DATE.test(e.date), 'Choose which date to change.');
    req(e.kind === 'cancel' || e.kind === 'move' || e.kind === 'note', 'Unknown kind of change.');
    req(!e.newDate || DATE.test(e.newDate), 'The new date must look like 2026-11-18.');
    req(!e.newStartTime || TIME.test(e.newStartTime), 'Times must look like 15:15.');
    req(!e.newEndTime || TIME.test(e.newEndTime), 'Times must look like 15:15.');
    if (e.kind === 'move') req(e.newDate || e.newStartTime || e.newLocation, 'Choose a new date, time or place.');
    return changed(c, store.saveException({
      activityId: e.activityId, date: e.date, kind: e.kind, newDate: e.newDate ?? null,
      newStartTime: e.newStartTime ?? null, newEndTime: e.newEndTime ?? null,
      newLocation: e.newLocation ?? null, note: e.note ?? null,
    }), 201);
  });

  app.delete('/api/exceptions/:id', c => {
    if (!store.deleteException(c.req.param('id'))) return c.json({ error: 'No such change.' }, 404);
    return changed(c, { ok: true });
  });

  // School calendar: snow days and other days added by hand
  app.post('/api/school-days', async c => {
    const d = await c.req.json<{ date?: string; label?: string; kind?: string }>();
    req(d.date && DATE.test(d.date), 'Choose a date.');
    const kind = d.kind === 'early_release' ? 'early_release' : 'no_school';
    const day = { date: d.date, kind, label: d.label?.trim() || 'Snow day', source: 'manual' } as const;
    store.saveSchoolDay(day);
    return changed(c, day, 201);
  });

  app.delete('/api/school-days/:date', c => {
    if (!store.deleteManualSchoolDays(c.req.param('date'))) return c.json({ error: 'No day added by hand on that date.' }, 404);
    return changed(c, { ok: true });
  });

  // Trips
  const checkTrip = (t: Partial<Trip>): Omit<Trip, 'id'> => {
    req(t.personId && (t.personId === EVERYONE || store.person(t.personId)), 'Choose who is traveling.');
    req(t.city && t.city.trim(), 'Enter the city.');
    req(t.tz && validTz(t.tz), 'Choose the time zone there.');
    req(t.startsOn && DATE.test(t.startsOn) && t.endsOn && DATE.test(t.endsOn), 'Choose the dates.');
    req(t.startsOn <= t.endsOn, 'The return date must be on or after the leaving date.');
    return {
      personId: t.personId, city: t.city.trim(), tz: t.tz, startsOn: t.startsOn, endsOn: t.endsOn,
      returnNote: t.returnNote?.trim() ?? '', demo: false,
    };
  };

  app.post('/api/trips', async c => changed(c, store.saveTrip(checkTrip(await c.req.json())), 201));
  app.put('/api/trips/:id', async c => {
    const existing = store.trips().find(t => t.id === c.req.param('id'));
    if (!existing) return c.json({ error: 'No such trip.' }, 404);
    return changed(c, store.saveTrip({ ...checkTrip({ ...existing, ...(await c.req.json()) }), id: existing.id }));
  });
  app.delete('/api/trips/:id', c => {
    if (!store.deleteTrip(c.req.param('id'))) return c.json({ error: 'No such trip.' }, 404);
    return changed(c, { ok: true });
  });

  // Calendar accounts (iCloud) and their calendars
  const calendarsBody = () => ({
    accounts: store.accounts(),
    calendars: store.calendarSources().map(({ ctag: _c, syncedFrom: _s, ...pub }) => pub),
  });
  const needSync = () => {
    if (!sync) throw new BadRequest('Calendar sync isn’t available on this server.');
    return sync;
  };

  app.get('/api/calendars', c => c.json(calendarsBody()));

  app.post('/api/calendar-accounts', async c => {
    const body = await c.req.json<{ personId?: string; username?: string; password?: string }>();
    req(body.personId && store.person(body.personId), 'Choose whose account this is.');
    req(body.username && /.+@.+/.test(body.username), 'Enter the Apple ID email address.');
    req(body.password && body.password.replace(/\s+/g, '').length >= 8, 'Enter the app-specific password (it looks like abcd-efgh-ijkl-mnop).');
    try {
      await needSync().addAccount({ personId: body.personId, username: body.username, password: body.password });
    } catch (err) {
      if (err instanceof BadRequest) throw err;
      throw new BadRequest((err as Error).message);
    }
    return changed(c, calendarsBody(), 201);
  });

  // Google: the client from Google Cloud, then a sign-in per account
  app.get('/api/google/config', c => {
    const client = sync?.googleClient() ?? null;
    return c.json({ configured: !!client, clientId: client?.clientId ?? '' });
  });

  app.put('/api/google/config', async c => {
    const body = await c.req.json<{ clientId?: string; clientSecret?: string }>();
    req(body.clientId && /\.apps\.googleusercontent\.com$/.test(body.clientId.trim()), 'The client ID ends in .apps.googleusercontent.com. Copy it from Google Cloud → Clients.');
    req(body.clientSecret && body.clientSecret.trim().length >= 10, 'Paste the client secret from the same Google Cloud client.');
    needSync().saveGoogleClient(body.clientId, body.clientSecret);
    return c.json({ configured: true, clientId: body.clientId.trim() });
  });

  app.post('/api/google/start', async c => {
    const body = await c.req.json<{ personId?: string }>();
    req(body.personId && store.person(body.personId), 'Choose whose account this is.');
    try {
      return c.json({ url: needSync().startGoogleSignIn(body.personId) });
    } catch (err) {
      if (err instanceof BadRequest) throw err;
      throw new BadRequest((err as Error).message);
    }
  });

  app.post('/api/google/finish', async c => {
    const body = await c.req.json<{ response?: string }>();
    req(body.response && body.response.trim(), 'Paste the address from the tab Google sent you to.');
    try {
      await needSync().finishGoogleSignIn(body.response);
    } catch (err) {
      if (err instanceof BadRequest) throw err;
      throw new BadRequest((err as Error).message);
    }
    return changed(c, calendarsBody(), 201);
  });

  app.delete('/api/calendar-accounts/:id', c => {
    if (!store.deleteAccount(c.req.param('id'))) return c.json({ error: 'No such account.' }, 404);
    return changed(c, calendarsBody());
  });

  app.post('/api/calendar-accounts/:id/sync', async c => {
    if (!store.account(c.req.param('id'))) return c.json({ error: 'No such account.' }, 404);
    await needSync().syncAccount(c.req.param('id'), { force: true });
    return changed(c, calendarsBody());
  });

  app.put('/api/calendars/:id', async c => {
    const source = store.calendarSource(c.req.param('id'));
    if (!source) return c.json({ error: 'No such calendar.' }, 404);
    const body = await c.req.json<{ enabled?: boolean; personId?: string | null }>();
    req(body.personId === undefined || body.personId === null || store.person(body.personId), 'No such person.');
    const next = {
      ...source,
      enabled: body.enabled ?? source.enabled,
      personId: body.personId === undefined ? source.personId : body.personId,
    };
    // Turning a calendar back on needs a fresh download.
    store.saveSource(next.enabled && !source.enabled ? { ...next, ctag: null } : next);
    if (next.personId !== source.personId) sync?.reassign();
    if (next.enabled !== source.enabled && sync) await sync.syncAccount(source.accountId);
    return changed(c, calendarsBody());
  });

  // Lists
  const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const nowIso = () => now().toISOString();

  /** Adds an item unless the same text is already open on that list. */
  const addItem = (listId: string, text: string, personId: string | null = null, dueOn: string | null = null) => {
    const existing = store.listItems(now()).find(i => i.listId === listId && !i.done && sameText(i.text, text));
    if (existing) return { item: existing, added: false };
    return {
      item: store.saveListItem({ listId, text: text.trim(), done: false, personId, dueOn, createdAt: nowIso(), doneAt: null }),
      added: true,
    };
  };

  app.post('/api/lists/:listId/items', async c => {
    const listId = c.req.param('listId');
    req(store.lists().some(l => l.id === listId), 'No such list.');
    const body = await c.req.json<{ text?: string; personId?: string | null; dueOn?: string | null }>();
    req(body.text && body.text.trim(), 'Type something to add.');
    req(!body.personId || store.person(body.personId), 'No such person.');
    req(!body.dueOn || DATE.test(body.dueOn), 'Due dates look like 2026-11-20.');
    const { item, added } = addItem(listId, body.text, body.personId ?? null, body.dueOn ?? null);
    return changed(c, { item, added }, added ? 201 : 200);
  });

  app.put('/api/items/:id', async c => {
    const item = store.listItem(c.req.param('id'));
    if (!item) return c.json({ error: 'That item was already removed.' }, 404);
    const body = await c.req.json<{ text?: string; done?: boolean; personId?: string | null; dueOn?: string | null }>();
    req(body.text === undefined || body.text.trim(), 'Items can’t be empty.');
    req(!body.personId || store.person(body.personId), 'No such person.');
    req(!body.dueOn || DATE.test(body.dueOn), 'Due dates look like 2026-11-20.');
    const done = body.done ?? item.done;
    const next = {
      ...item,
      text: body.text?.trim() ?? item.text,
      personId: body.personId === undefined ? item.personId : body.personId,
      dueOn: body.dueOn === undefined ? item.dueOn : body.dueOn,
      done,
      doneAt: done ? (item.done ? item.doneAt : nowIso()) : null,
    };
    store.saveListItem(next);
    return changed(c, next);
  });

  app.delete('/api/items/:id', c => {
    if (!store.deleteListItem(c.req.param('id'))) return c.json({ error: 'That item was already removed.' }, 404);
    return changed(c, { ok: true });
  });

  app.post('/api/lists/:listId/clear-done', c => changed(c, { removed: store.clearDone(c.req.param('listId')) }));

  // Saved meals
  const toIngredients = (v: unknown): string[] =>
    (Array.isArray(v) ? v : String(v ?? '').split('\n')).map(s => String(s).trim()).filter(Boolean);

  app.post('/api/meals', async c => {
    const body = await c.req.json<{ name?: string; url?: string; notes?: string; ingredients?: unknown }>();
    req(body.name && body.name.trim(), 'Give the meal a name.');
    req(!store.mealByName(body.name), `“${body.name.trim()}” is already saved.`);
    return changed(c, store.saveMeal({
      name: body.name.trim(), url: body.url?.trim() ?? '', notes: body.notes?.trim() ?? '', ingredients: toIngredients(body.ingredients),
    }), 201);
  });

  app.put('/api/meals/:id', async c => {
    const meal = store.meal(c.req.param('id'));
    if (!meal) return c.json({ error: 'No such meal.' }, 404);
    const body = await c.req.json<{ name?: string; url?: string; notes?: string; ingredients?: unknown }>();
    req(body.name === undefined || body.name.trim(), 'Give the meal a name.');
    const other = body.name ? store.mealByName(body.name) : undefined;
    req(!other || other.id === meal.id, `“${body.name?.trim()}” is already saved.`);
    const next = {
      ...meal, name: body.name?.trim() ?? meal.name, url: body.url?.trim() ?? meal.url, notes: body.notes?.trim() ?? meal.notes,
      ingredients: body.ingredients === undefined ? meal.ingredients : toIngredients(body.ingredients),
    };
    store.saveMeal(next);
    // Keep planned dinners' titles in step with a renamed meal.
    if (next.name !== meal.name) {
      for (const d of store.dinners('0000-01-01', '9999-12-31')) if (d.mealId === meal.id) store.saveDinner({ ...d, title: next.name });
    }
    return changed(c, next);
  });

  app.delete('/api/meals/:id', c => {
    if (!store.deleteMeal(c.req.param('id'))) return c.json({ error: 'No such meal.' }, 404);
    return changed(c, { ok: true });
  });

  // Dinners
  app.put('/api/dinners/:date', async c => {
    const date = c.req.param('date');
    req(DATE.test(date), 'Dates look like 2026-11-20.');
    const body = await c.req.json<{ title?: string; cookId?: string | null; note?: string }>();
    const title = body.title?.trim() ?? '';
    if (!title) { store.deleteDinner(date); return changed(c, { date, removed: true }); }
    req(!body.cookId || store.person(body.cookId), 'No such person.');
    // New dinners are saved as meals, so next time they're one tap away.
    const meal = store.mealByName(title) ?? store.saveMeal({ name: title, url: '', notes: '', ingredients: [] });
    const dinner = { date, mealId: meal.id, title: meal.name, cookId: body.cookId ?? null, note: body.note?.trim() ?? '' };
    store.saveDinner(dinner);
    return changed(c, dinner);
  });

  app.post('/api/dinners/copy-week', async c => {
    const { from } = await c.req.json<{ from?: string }>();
    req(from && DATE.test(from), 'Choose the week to fill.');
    const last = store.dinners(addDays(from, -7), addDays(from, -1));
    const taken = new Set(store.dinners(from, addDays(from, 6)).map(d => d.date));
    let copied = 0;
    for (const d of last) {
      const date = addDays(d.date, 7);
      if (taken.has(date)) continue;
      store.saveDinner({ ...d, date });
      copied++;
    }
    return changed(c, { copied });
  });

  app.post('/api/dinners/groceries', async c => {
    const { from, to } = await c.req.json<{ from?: string; to?: string }>();
    req(from && to && DATE.test(from) && DATE.test(to), 'Choose the dates.');
    const grocery = store.lists().find(l => l.kind === 'grocery');
    req(grocery, 'There’s no grocery list.');
    const added: string[] = [];
    const missing: string[] = [];
    for (const d of store.dinners(from, to)) {
      const meal = d.mealId ? store.meal(d.mealId) : undefined;
      if (!meal?.ingredients.length) { missing.push(d.title); continue; }
      for (const ing of meal.ingredients) if (addItem(grocery.id, ing).added) added.push(ing);
    }
    return changed(c, { added, missing: [...new Set(missing)] });
  });

  // Settings
  app.put('/api/settings', async c => {
    const s = await c.req.json<Partial<Settings>>();
    req(s.timezone === undefined || validTz(s.timezone), 'Unknown time zone.');
    req(s.latitude === undefined || (typeof s.latitude === 'number' && Math.abs(s.latitude) <= 90), 'Latitude must be a number between -90 and 90.');
    req(s.longitude === undefined || (typeof s.longitude === 'number' && Math.abs(s.longitude) <= 180), 'Longitude must be a number between -180 and 180.');
    req(s.dimStart === undefined || TIME.test(s.dimStart), 'Times must look like 21:00.');
    req(s.dimEnd === undefined || TIME.test(s.dimEnd), 'Times must look like 06:30.');
    req(s.idleMinutes === undefined || (Number.isInteger(s.idleMinutes) && s.idleMinutes >= 1), 'Idle minutes must be a whole number of at least 1.');
    return changed(c, store.saveSettings(s));
  });

  // Sample data
  app.post('/api/demo/load', c => { loadDemoData(store, now()); return changed(c, { ok: true }); });
  app.post('/api/demo/clear', c => { store.clearDemoData(); return changed(c, { ok: true }); });

  // Live updates
  app.get('/api/stream', c => streamSSE(c, async stream => {
    let alive = true;
    const off = bus.on(() => { void stream.writeSSE({ event: 'change', data: String(Date.now()) }); });
    stream.onAbort(() => { alive = false; off(); });
    await stream.writeSSE({ event: 'hello', data: 'ok' });
    while (alive) {
      await stream.sleep(25_000);
      if (alive) await stream.writeSSE({ event: 'ping', data: '' });
    }
  }));

  return app;
}
