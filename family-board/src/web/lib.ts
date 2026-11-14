/** Turns the board into what each screen shows: one list of items per person per day,
 *  mixing calendar events and kid activities. */

import type { CSSProperties } from 'react';
import { EVERYONE, type Board, type CalendarEvent, type Occurrence, type OccurrenceStatus, type Person, type Trip } from '../shared/types';
import { daysBetween, formatTime, shortDate, timeToMinutes, toZoned, zoneAbbrev } from '../shared/dates';

export interface DayItem {
  key: string;
  kind: 'event' | 'activity' | 'todo';
  /** For to-dos: the list item, so it can be checked off from any screen. */
  itemId?: string;
  done?: boolean;
  personIds: string[];
  title: string;
  icon: string;
  allDay: boolean;
  /** Minutes after midnight in the household time zone; -1 for all-day items. */
  minutes: number;
  endMinutes: number;
  timeLabel: string;
  /** For someone traveling: the time where they are, e.g. "9:00 AM MT". */
  awayTimeLabel?: string;
  location: string;
  status: OccurrenceStatus;
  reason?: string;
  note?: string;
}

function eventItem(e: CalendarEvent, date: string, board: Board): DayItem | null {
  const tz = board.settings.timezone;
  if (e.allDay) {
    if (!(e.start <= date && date < e.end)) return null;
    return {
      key: `e-${e.id}`, kind: 'event', personIds: e.personIds, title: e.title, icon: '', allDay: true,
      minutes: -1, endMinutes: -1, timeLabel: 'All day', location: e.location, status: 'on',
    };
  }
  const start = toZoned(e.start, tz);
  if (start.date !== date) return null;
  const end = toZoned(e.end, tz);
  const item: DayItem = {
    key: `e-${e.id}`, kind: 'event', personIds: e.personIds, title: e.title, icon: '', allDay: false,
    minutes: start.minutes, endMinutes: end.date === date ? end.minutes : 24 * 60,
    timeLabel: formatTime(start.time), location: e.location, status: 'on',
  };
  // Show the traveler's local time when it differs from home.
  const trip = e.personIds.length === 1 ? activeTrip(board, e.personIds[0], date) : null;
  if (trip && trip.tz !== tz) {
    const local = toZoned(e.start, trip.tz);
    if (local.time !== start.time) item.awayTimeLabel = `${formatTime(local.time)} ${zoneAbbrev(trip.tz, new Date(e.start))}`;
  }
  return item;
}

function occurrenceItem(o: Occurrence): DayItem {
  return {
    key: `a-${o.activityId}-${o.date}-${o.status}`, kind: 'activity', personIds: [o.personId],
    title: o.name, icon: o.icon, allDay: false, minutes: timeToMinutes(o.startTime),
    endMinutes: timeToMinutes(o.endTime),
    timeLabel: `${formatTime(o.startTime)}–${formatTime(o.endTime)}`,
    location: o.location, status: o.status, reason: o.reason, note: o.note,
  };
}

/** Every item on a date, sorted with all-day items first. */
/** To-dos due on a date. Today also shows anything overdue. */
function todoItems(board: Board, date: string): DayItem[] {
  return board.items
    .filter(i => i.dueOn && (i.dueOn === date || (date === board.today && i.dueOn < date && !i.done)))
    .map(i => ({
      key: `t-${i.id}`, kind: 'todo' as const, itemId: i.id, done: i.done, personIds: i.personId ? [i.personId] : [],
      title: i.text, icon: '', allDay: true, minutes: -1, endMinutes: -1,
      timeLabel: i.dueOn! < date ? `Overdue · was due ${shortDate(i.dueOn!)}` : 'To do',
      location: '', status: 'on' as const,
    }));
}

/** The dinner planned for a date, if any. */
export function dinnerOn(board: Board, date: string) {
  return board.dinners.find(d => d.date === date);
}

export function itemsOn(board: Board, date: string): DayItem[] {
  const items = [
    ...todoItems(board, date),
    ...board.events.map(e => eventItem(e, date, board)).filter((x): x is DayItem => !!x),
    ...board.occurrences.filter(o => o.date === date).map(occurrenceItem),
  ];
  return items.sort((a, b) => a.minutes - b.minutes || a.title.localeCompare(b.title));
}

/** Items for one person, or for the family (items with no person) when id is null. */
export function itemsFor(board: Board, date: string, personId: string | null): DayItem[] {
  return itemsOn(board, date).filter(i =>
    personId === null ? i.personIds.length === 0 : i.personIds.includes(personId));
}

const covers = (t: Trip, date: string) => t.startsOn <= date && date <= t.endsOn;

/** A trip this person takes on their own. */
export function personalTrip(board: Board, personId: string, date: string): Trip | null {
  return board.trips.find(t => t.personId === personId && covers(t, date)) ?? null;
}

/** A trip the whole family takes, such as a vacation. */
export function familyTrip(board: Board, date: string): Trip | null {
  return board.trips.find(t => t.personId === EVERYONE && covers(t, date)) ?? null;
}

/** Whether this person is away, on their own trip or with everyone. */
export function activeTrip(board: Board, personId: string, date: string): Trip | null {
  return personalTrip(board, personId, date) ?? familyTrip(board, date);
}

/** Everyone who is away on a date: the family trip first, then individual trips. */
export function awayOn(board: Board, date: string): Array<{ trip: Trip; person: Person | null }> {
  const family = familyTrip(board, date);
  const out: Array<{ trip: Trip; person: Person | null }> = family ? [{ trip: family, person: null }] : [];
  for (const p of board.people) {
    const t = personalTrip(board, p.id, date);
    if (t) out.push({ trip: t, person: p });
  }
  return out;
}

export function tripProgress(trip: Trip, today: string) {
  const total = Math.max(1, daysBetween(trip.startsOn, trip.endsOn));
  const left = Math.max(0, daysBetween(today, trip.endsOn));
  return { total, left, done: total - left, day: daysBetween(trip.startsOn, today) + 1, days: total + 1 };
}

export function personById(board: Board, id: string): Person | undefined {
  return board.people.find(p => p.id === id);
}

/** CSS custom property for a person's color, used by tints throughout the stylesheet. */
export function colorVar(p: Person | undefined): CSSProperties {
  return { '--c': p?.color ?? 'var(--family)' } as CSSProperties;
}

export function nowMinutes(board: Board, now: Date): { date: string; minutes: number } {
  const z = toZoned(now, board.settings.timezone);
  return { date: z.date, minutes: z.minutes };
}

/** Whether the display should be dimmed (the window can cross midnight). */
export function isDimTime(board: Board, now: Date): boolean {
  const { minutes } = nowMinutes(board, now);
  const start = timeToMinutes(board.settings.dimStart);
  const end = timeToMinutes(board.settings.dimEnd);
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
