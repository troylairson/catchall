import type { Store } from './store';
import type { Board, SyncProblem, Weather } from '../shared/types';
import { mergeDuplicates } from '../shared/assign';
import { answerFor, makeContext, occurrencesFor } from '../shared/recurrence';
import { addDays, startOfWeek, toZoned } from '../shared/dates';

/** Everything a screen needs for a date range, in one response. The default range is
 *  the current Monday–Sunday week, which covers the Today, Week and Kids views. */
export function buildBoard(
  store: Store, opts: { from?: string; to?: string; now?: Date; weather?: Weather | null } = {},
): Board {
  const settings = store.settings();
  const today = toZoned(opts.now ?? new Date(), settings.timezone).date;
  const from = opts.from ?? startOfWeek(today);
  const to = opts.to ?? addDays(from, 6);

  const schoolDays = store.schoolDays();
  const schoolYear = store.schoolYear();
  const exceptions = store.exceptions();
  const allTrips = store.trips();
  const ctx = makeContext(schoolDays, schoolYear, exceptions, allTrips);
  const activities = store.activities();
  const enabled = new Set(store.calendarSources().filter(c => c.enabled).map(c => c.id));

  return {
    today, from, to, settings,
    people: store.people(),
    events: mergeDuplicates(store.events(from, to).filter(e => e.calendarId === 'sample' || enabled.has(e.calendarId))),
    activities,
    occurrences: activities.flatMap(a => occurrencesFor(a, from, to, ctx)),
    answers: activities.map(a => answerFor(a, today, ctx)),
    schoolDays: schoolDays.filter(d => d.date >= from && d.date <= addDays(to, 60)),
    schoolYear,
    trips: allTrips.filter(t => t.endsOn >= from && t.startsOn <= to),
    exceptions: exceptions.filter(e => e.date >= addDays(today, -7)),
    weather: opts.weather ?? null,
    hasDemoData: store.hasDemoData(),
    syncProblems: syncProblems(store, opts.now ?? new Date()),
    lists: store.lists(),
    items: store.listItems(opts.now ?? new Date()),
    meals: store.meals(),
    dinners: store.dinners(from, to),
  };
}

/** Accounts or calendars that failed, or whose last good sync is over an hour old. */
export function syncProblems(store: Store, now: Date): SyncProblem[] {
  const out: SyncProblem[] = [];
  const hourAgo = new Date(now.getTime() - 60 * 60_000).toISOString();
  for (const a of store.accounts()) {
    const owner = store.person(a.personId)?.name ?? 'Someone';
    const name = `${owner}’s ${a.kind === 'google' ? 'Google' : 'iCloud'}`;
    if (a.lastError) out.push({ name, message: a.lastError });
    else if (!a.lastSyncedAt || a.lastSyncedAt < hourAgo) out.push({ name, message: 'Hasn’t synced in over an hour.' });
    else {
      for (const c of store.calendarSources(a.id)) {
        if (c.enabled && c.lastError) out.push({ name: `${owner}’s “${c.name}” calendar`, message: c.lastError });
      }
    }
  }
  return out;
}
