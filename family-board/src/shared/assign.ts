/** Which people an event belongs to, and merging copies of one event that appear on
 *  several calendars (an invitation, or an event copied to a personal calendar). */

import type { CalendarEvent, Person } from './types';

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

/** A personal calendar's events go to its owner. A family calendar's events go to
 *  whoever the title names, or to the whole family when it names no one. */
export function assignPeople(title: string, calendarPersonId: string | null, people: Person[]): string[] {
  if (calendarPersonId) return [calendarPersonId];
  return people.filter(p => mentions(title, p)).map(p => p.id);
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
