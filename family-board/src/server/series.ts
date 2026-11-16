/** Turns repeating events from Settings into dated events for a range. */

import { MANUAL_CALENDAR, type CalendarEvent, type EventSeries } from '../shared/types';
import { expandRule, schoolStatus, type ScheduleContext } from '../shared/recurrence';
import { addDays, fromZoned } from '../shared/dates';

export function seriesEvents(
  series: EventSeries[], from: string, to: string, tz: string, school: Pick<ScheduleContext, 'schoolDays' | 'schoolYear'>,
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const s of series) {
    const skip = new Set(s.skipDates);
    for (const date of expandRule(s.rrule, s.startsOn, s.endsOn, from, to)) {
      if (skip.has(date)) continue;
      if (s.skipNoSchool && schoolStatus(date, school)?.kind === 'no_school') continue;
      const start = s.startTime ? fromZoned(date, s.startTime, tz) : null;
      out.push({
        // Stable per date, so screens can tell occurrences apart.
        id: `series:${s.id}:${date}`,
        calendarId: MANUAL_CALENDAR,
        title: s.title,
        allDay: !start,
        start: start ? start.toISOString() : date,
        end: start
          ? (s.endTime ? fromZoned(date, s.endTime, tz) : new Date(start.getTime() + 3_600_000)).toISOString()
          : addDays(date, 1),
        location: s.location,
        notes: '',
        personIds: s.personIds,
        externalUid: `series:${s.id}`,
        demo: false,
      });
    }
  }
  return out;
}
