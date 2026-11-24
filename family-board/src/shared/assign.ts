/** Which people an event belongs to, and merging copies of one event that appear on
 *  several calendars (an invitation, or an event copied to a personal calendar). */

import type { CalendarEvent, Person } from './types';
import { addDays } from './dates';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when a title mentions the person by name (as a whole word) or by a keyword. */
export function mentions(title: string, person: Person): boolean {
  const name = person.name.trim();
  if (name && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}($|[^\\p{L}\\p{N}])`, 'iu').test(title)) return true;
  const lower = title.toLowerCase();
  return person.keywords.some(k => k.trim() && lower.includes(k.trim().toLowerCase()));
}

/** An event goes to whoever its title names ("Lincoln Chess" goes to Lincoln, wherever
 *  it's saved). Otherwise it goes to the calendar's owner, or to the whole family for a
 *  Family calendar. */
export function assignPeople(title: string, calendarPersonId: string | null, people: Person[]): string[] {
  const named = people.filter(p => mentions(title, p)).map(p => p.id);
  if (named.length) return named;
  return calendarPersonId ? [calendarPersonId] : [];
}

function key(e: CalendarEvent): string {
  return e.externalUid ? `uid:${e.externalUid}|${e.start}` : `title:${e.title.trim().toLowerCase()}|${e.start}`;
}

/** Collapses copies of one event into a single event shown in every column it belongs
 *  to. Copies match by UID and start time, or else by title and start time. */
export function mergeDuplicates(events: CalendarEvent[]): CalendarEvent[] {
  const byKey = new Map<string, CalendarEvent>();
  const byTitle = new Map<string, CalendarEvent>();
  const out: CalendarEvent[] = [];
  for (const e of events) {
    const titleKey = `title:${e.title.trim().toLowerCase()}|${e.start}`;
    const existing = byKey.get(key(e)) ?? byTitle.get(titleKey);
    if (existing) {
      existing.personIds = [...new Set([...existing.personIds, ...e.personIds])];
      if (!existing.location && e.location) existing.location = e.location;
      continue;
    }
    const copy = { ...e, personIds: [...e.personIds] };
    byKey.set(key(copy), copy);
    byTitle.set(titleKey, copy);
    out.push(copy);
  }
  return out;
}

// ---------- Hiding calendar events that repeat a kid's activity ----------

/** Words that say what kind of thing it is rather than which thing, so they don't count as a match. */
const GENERIC = new Set([
  'the', 'and', 'for', 'with', 'from', 'club', 'clubs', 'practice', 'practices', 'lesson', 'lessons', 'game', 'games',
  'class', 'classes', 'team', 'meeting', 'meet', 'day', 'today', 'pick', 'pickup', 'drop', 'off', 'after', 'school',
]);

/** The distinctive words in a title, lowercased and roughly singular, without people's names. */
export function keyWords(title: string, people: Person[]): Set<string> {
  const names = new Set(people.map(p => p.name.trim().toLowerCase()));
  const words = title.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/);
  return new Set(words
    .filter(w => w.length >= 3 && !GENERIC.has(w) && !names.has(w))
    .map(w => w.replace(/(ing|es|s)$/, '')));
}

export interface ActivitySlot {
  personId: string;
  date: string;
  name: string;
  startMinutes: number;
  endMinutes: number;
}

/** Drops calendar events that are the same thing as a kid's activity on the same day: the
 *  same person, overlapping times (any time for an all-day event), and a shared key word,
 *  e.g. "Lincoln Swim Lessons" and the "Swim lessons" activity. The activity stays, since it
 *  knows about school days, trips and one-off changes. */
export function hideActivityDuplicates(
  events: CalendarEvent[], slots: ActivitySlot[], people: Person[],
  localTime: (iso: string) => { date: string; minutes: number },
): CalendarEvent[] {
  if (!slots.length) return events;
  const slotWords = new Map(slots.map(s => [s, keyWords(s.name, people)]));
  return events.filter(e => {
    if (!e.personIds.length) return true;
    const words = keyWords(e.title, people);
    if (!words.size) return true;
    let dates: string[];
    let start = 0;
    let end = 24 * 60;
    if (e.allDay) {
      dates = [];
      for (let d = e.start; d < e.end && dates.length < 31; d = addDays(d, 1)) dates.push(d);
    } else {
      const s = localTime(e.start);
      const t = localTime(e.end);
      dates = [s.date];
      start = s.minutes;
      end = t.date === s.date ? Math.max(t.minutes, start + 1) : 24 * 60;
    }
    const matches = (personId: string) => slots.some(s =>
      s.personId === personId && dates.includes(s.date)
      && (e.allDay || (start < s.endMinutes && s.startMinutes < end))
      && [...slotWords.get(s)!].some(w => words.has(w)));
    // Only hide it when it's a duplicate for everyone it belongs to.
    return !e.personIds.every(matches);
  });
}
