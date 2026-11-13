import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Store } from './store';
import { buildBoard } from './board';
import { loadDemoData } from './seed';
import { getWeather } from './weather';
import type { CalendarSync } from './sync';
import { isHexColor } from '../shared/colors';
import type { Activity, ActivityException, Settings, Trip } from '../shared/types';

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
    req(t.personId && store.person(t.personId), 'Choose who is traveling.');
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
