import type { Store } from './store';
import type { Board, Weather } from '../shared/types';
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
  const ctx = makeContext(schoolDays, schoolYear, exceptions);
  const activities = store.activities();

  return {
    today, from, to, settings,
    people: store.people(),
    events: store.events(from, to),
    activities,
    occurrences: activities.flatMap(a => occurrencesFor(a, from, to, ctx)),
    answers: activities.map(a => answerFor(a, today, ctx)),
    schoolDays: schoolDays.filter(d => d.date >= from && d.date <= addDays(to, 60)),
    schoolYear,
    trips: store.trips().filter(t => t.endsOn >= from && t.startsOn <= to),
    exceptions: exceptions.filter(e => e.date >= addDays(today, -7)),
    weather: opts.weather ?? null,
    hasDemoData: store.hasDemoData(),
  };
}
