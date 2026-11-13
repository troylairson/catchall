/** Turns iCalendar (ICS) text into dated events inside a window, expanding repeating
 *  events and applying their skipped (EXDATE) and moved (RECURRENCE-ID) dates. */

import ICAL from 'ical.js';
import { addDays, fromZoned } from '../shared/dates';

export interface ParsedEvent {
  uid: string;
  title: string;
  allDay: boolean;
  /** ISO instant, or 'YYYY-MM-DD' for all-day events. */
  start: string;
  /** ISO instant, or exclusive 'YYYY-MM-DD' for all-day events. */
  end: string;
  location: string;
  notes: string;
}

// Outlook invitations often use Windows zone names.
const WINDOWS_ZONES: Record<string, string> = {
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  UTC: 'UTC',
};

function ianaZone(tzid: string | null | undefined, fallback: string): string {
  if (!tzid) return fallback;
  const cleaned = tzid.replace(/^\/+/, '').trim();
  const candidate = WINDOWS_ZONES[cleaned] ?? cleaned;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return fallback;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

function dateOf(t: ICAL.Time): string {
  return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
}

/** The instant for a time: UTC times as-is, others from their wall clock and zone. */
function instantOf(t: ICAL.Time, tzid: string | null, householdTz: string): string {
  if (t.zone === ICAL.Timezone.utcTimezone) return t.toJSDate().toISOString();
  return fromZoned(dateOf(t), `${pad(t.hour)}:${pad(t.minute)}`, ianaZone(tzid, householdTz)).toISOString();
}

function tzidOf(component: ICAL.Component, prop: 'dtstart' | 'dtend'): string | null {
  const p = component.getFirstProperty(prop);
  const v = p?.getParameter('tzid');
  return typeof v === 'string' ? v : null;
}

function text(component: ICAL.Component, prop: string): string {
  const v = component.getFirstPropertyValue(prop);
  return typeof v === 'string' ? v.trim() : '';
}

function isCancelled(component: ICAL.Component): boolean {
  return String(component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';
}

function build(
  component: ICAL.Component, uid: string, start: ICAL.Time, end: ICAL.Time, householdTz: string,
): ParsedEvent {
  const allDay = start.isDate;
  let s: string;
  let e: string;
  if (allDay) {
    s = dateOf(start);
    e = end.isDate ? dateOf(end) : addDays(s, 1);
    if (e <= s) e = addDays(s, 1);
  } else {
    s = instantOf(start, tzidOf(component, 'dtstart'), householdTz);
    e = instantOf(end, tzidOf(component, 'dtend') ?? tzidOf(component, 'dtstart'), householdTz);
    if (e < s) e = s;
  }
  return {
    uid, title: text(component, 'summary') || '(No title)', allDay, start: s, end: e,
    location: text(component, 'location'), notes: text(component, 'description'),
  };
}

/** Does the event touch the window? `from` and `to` are inclusive dates. */
function inWindow(ev: ParsedEvent, from: string, to: string): boolean {
  const startDay = ev.start.slice(0, 10);
  const endDay = ev.end.slice(0, 10);
  // Instants are UTC, so allow a day either side; screens filter by local date.
  return startDay <= addDays(to, 1) && endDay >= addDays(from, -1);
}

const MAX_OCCURRENCES = 20_000;

export function parseIcs(ics: string, from: string, to: string, householdTz: string): ParsedEvent[] {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(ics));
  } catch {
    return [];
  }
  const vevents = root.getAllSubcomponents('vevent');
  const byUid = new Map<string, { master?: ICAL.Component; exceptions: ICAL.Component[] }>();
  for (const v of vevents) {
    const uid = text(v, 'uid') || `no-uid-${byUid.size}`;
    const entry = byUid.get(uid) ?? { exceptions: [] };
    if (v.hasProperty('recurrence-id')) entry.exceptions.push(v);
    else entry.master = v;
    byUid.set(uid, entry);
  }

  const out: ParsedEvent[] = [];
  const stopAfter = addDays(to, 2);

  for (const [uid, { master, exceptions }] of byUid) {
    if (!master) {
      // A moved occurrence whose series isn't in this file; show it on its own.
      for (const ex of exceptions) {
        if (isCancelled(ex)) continue;
        const ev = new ICAL.Event(ex);
        const item = build(ex, uid, ev.startDate, ev.endDate, householdTz);
        if (inWindow(item, from, to)) out.push(item);
      }
      continue;
    }
    const event = new ICAL.Event(master);
    for (const ex of exceptions) event.relateException(ex);

    if (!event.isRecurring()) {
      if (isCancelled(master)) continue;
      const item = build(master, uid, event.startDate, event.endDate, householdTz);
      if (inWindow(item, from, to)) out.push(item);
      continue;
    }

    const it = event.iterator();
    let next: ICAL.Time | null;
    let count = 0;
    while ((next = it.next()) && count++ < MAX_OCCURRENCES) {
      if (dateOf(next) > stopAfter) break;
      const details = event.getOccurrenceDetails(next);
      const component = details.item.component;
      if (isCancelled(component)) continue;
      const item = build(component, uid, details.startDate, details.endDate, householdTz);
      if (inWindow(item, from, to)) out.push(item);
    }
  }
  return out;
}
