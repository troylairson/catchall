/** Turns activity rules ("Tue & Thu, skip days with no school, ends Dec 17") into
 *  dated occurrences, and answers "is it on today, and when is it next?". */

import { RRule, Weekday } from 'rrule';
import {
  EVERYONE, type Activity, type ActivityAnswer, type ActivityException, type Occurrence,
  type SchoolDay, type SchoolYear, type Trip,
} from './types';
import { addDays, formatDate, parseDate, shortDate, formatTime } from './dates';

export interface ScheduleContext {
  schoolDays: Map<string, SchoolDay[]>;
  schoolYear: SchoolYear | null;
  /** Exceptions for any activity; filtered by activityId here. */
  exceptions: ActivityException[];
  /** While someone is away (or everyone is), their activities don't happen. */
  trips: Trip[];
}

export function indexSchoolDays(days: SchoolDay[]): Map<string, SchoolDay[]> {
  const map = new Map<string, SchoolDay[]>();
  for (const d of days) map.set(d.date, [...(map.get(d.date) ?? []), d]);
  return map;
}

export function makeContext(
  schoolDays: SchoolDay[], schoolYear: SchoolYear | null, exceptions: ActivityException[], trips: Trip[] = [],
): ScheduleContext {
  return { schoolDays: indexSchoolDays(schoolDays), schoolYear, exceptions, trips };
}

/** The trip that takes this person away on this date, if any. */
export function tripOn(personId: string, date: string, trips: Trip[]): Trip | null {
  return trips.find(t => (t.personId === personId || t.personId === EVERYONE) && t.startsOn <= date && date <= t.endsOn) ?? null;
}

/** Whether there's no school or early release on a date, with the reason. */
export function schoolStatus(
  date: string, ctx: Pick<ScheduleContext, 'schoolDays' | 'schoolYear'>,
): { kind: 'no_school' | 'early_release'; label: string } | null {
  const days = ctx.schoolDays.get(date) ?? [];
  const off = days.find(d => d.kind === 'no_school');
  if (off) return { kind: 'no_school', label: off.label };
  const early = days.find(d => d.kind === 'early_release');
  if (early) return { kind: 'early_release', label: early.label };
  if (ctx.schoolYear) {
    if (date < ctx.schoolYear.firstStudentDay) return { kind: 'no_school', label: 'School hasn’t started' };
    if (date > ctx.schoolYear.lastStudentDay) return { kind: 'no_school', label: 'Summer break' };
  }
  return null;
}

function ruleFor(activity: Activity): RRule {
  const opts = RRule.parseString(activity.rrule);
  return new RRule({
    ...opts,
    dtstart: parseDate(activity.startsOn),
    until: activity.endsOn ? new Date(parseDate(activity.endsOn).getTime() + 86_399_000) : null,
  });
}

/** Dates the rule produces between `from` and `to` (inclusive), ignoring school days. */
export function expandDates(activity: Activity, from: string, to: string): string[] {
  if (to < activity.startsOn || (activity.endsOn && from > activity.endsOn)) return [];
  const end = new Date(parseDate(to).getTime() + 86_399_000);
  return ruleFor(activity).between(parseDate(from), end, true).map(formatDate);
}

function base(activity: Activity, date: string): Occurrence {
  return {
    activityId: activity.id, personId: activity.personId, name: activity.name, icon: activity.icon,
    date, startTime: activity.startTime, endTime: activity.endTime, location: activity.location,
    status: 'on',
  };
}

export function occurrencesFor(
  activity: Activity, from: string, to: string, ctx: ScheduleContext,
): Occurrence[] {
  const exceptions = ctx.exceptions.filter(e => e.activityId === activity.id);
  const byDate = new Map<string, ActivityException[]>();
  for (const e of exceptions) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  const out: Occurrence[] = [];
  for (const date of expandDates(activity, from, to)) {
    const occ = base(activity, date);
    const exs = byDate.get(date) ?? [];
    const cancel = exs.find(e => e.kind === 'cancel');
    const move = exs.find(e => e.kind === 'move');
    const note = exs.find(e => e.kind === 'note');
    if (note?.note) occ.note = note.note;
    if (note?.newLocation) occ.location = note.newLocation;

    if (cancel) {
      occ.status = 'cancelled';
      occ.reason = cancel.note || 'Cancelled';
    } else if (move && move.newDate && move.newDate !== date) {
      occ.status = 'moved';
      occ.reason = `Moved to ${shortDate(move.newDate)}`;
    } else {
      if (move) {
        // Same day, new time or place.
        occ.startTime = move.newStartTime || occ.startTime;
        occ.endTime = move.newEndTime || occ.endTime;
        occ.location = move.newLocation || occ.location;
        occ.movedFrom = date;
        occ.note = move.note || `Time changed from ${formatTime(activity.startTime)}`;
      }
      const trip = move ? null : tripOn(activity.personId, date, ctx.trips);
      const school = schoolStatus(date, ctx);
      if (trip) {
        occ.status = 'skipped';
        occ.reason = `Away in ${trip.city}`;
      } else if (school && activity.skipOn.includes(school.kind) && !move) {
        occ.status = 'skipped';
        occ.reason = school.label;
      }
    }
    out.push(occ);
  }

  // Occurrences moved into this range from another date. A deliberate move always
  // happens, even on a day the rule would normally skip.
  for (const e of exceptions) {
    if (e.kind !== 'move' || !e.newDate || e.newDate === e.date) continue;
    if (e.newDate < from || e.newDate > to) continue;
    if (!expandDates(activity, e.date, e.date).length) continue;
    out.push({
      ...base(activity, e.newDate),
      startTime: e.newStartTime || activity.startTime,
      endTime: e.newEndTime || activity.endTime,
      location: e.newLocation || activity.location,
      movedFrom: e.date,
      note: e.note || `Moved from ${shortDate(e.date)}`,
    });
  }

  return out.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}

/** "Is it on today?" plus the next date it happens. Looks up to about a year ahead. */
export function answerFor(activity: Activity, today: string, ctx: ScheduleContext): ActivityAnswer {
  const todays = occurrencesFor(activity, today, today, ctx);
  const on = todays.find(o => o.status === 'on') ?? null;
  let next: Occurrence | null = null;
  for (let start = addDays(today, 1), i = 0; i < 7 && !next; i++, start = addDays(start, 60)) {
    next = occurrencesFor(activity, start, addDays(start, 59), ctx).find(o => o.status === 'on') ?? null;
  }
  return { activityId: activity.id, today: on ?? todays[0] ?? null, happening: !!on, next };
}

// ---------- Plain-English rules and the editor's presets ----------

const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ORDINALS: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', [-1]: 'last' };

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} & ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} & ${items[items.length - 1]}`;
}

/** Rule presets the activity editor offers. Days use 0 = Monday … 6 = Sunday. */
export type RulePreset =
  | { kind: 'weekly'; days: number[]; interval: 1 | 2 }
  | { kind: 'monthly'; nths: number[]; day: number };

export function buildRule(p: RulePreset): string {
  if (p.kind === 'weekly') {
    const days = [...p.days].sort().map(d => DAY_CODES[d]).join(',');
    return `FREQ=WEEKLY${p.interval === 2 ? ';INTERVAL=2' : ''};BYDAY=${days}`;
  }
  const nths = [...p.nths].sort((a, b) => (a < 0 ? 9 : a) - (b < 0 ? 9 : b));
  return `FREQ=MONTHLY;BYDAY=${nths.map(n => `${n}${DAY_CODES[p.day]}`).join(',')}`;
}

/** The preset a rule matches, if it matches one; used to prefill the editor. */
export function parsePreset(rrule: string): RulePreset | null {
  try {
    const o = RRule.parseString(rrule);
    const days = ((o.byweekday ?? []) as Weekday[]).map(w => (typeof w === 'number' ? { weekday: w, n: undefined } : w));
    if (o.freq === RRule.WEEKLY && days.length && days.every(d => !d.n)) {
      const interval = o.interval ?? 1;
      if (interval !== 1 && interval !== 2) return null;
      return { kind: 'weekly', days: days.map(d => d.weekday), interval };
    }
    if (o.freq === RRule.MONTHLY && days.length && days.every(d => d.n && d.weekday === days[0].weekday)) {
      return { kind: 'monthly', nths: days.map(d => d.n as number), day: days[0].weekday };
    }
  } catch { /* fall through */ }
  return null;
}

/** "Every Tue & Thu", "Every other Monday", "2nd & 4th Thursday". */
export function describeRule(rrule: string): string {
  const p = parsePreset(rrule);
  if (p?.kind === 'weekly') {
    const names = [...p.days].sort().map(d => (p.days.length === 1 ? DAY_LONG[d] : DAY_SHORT[d]));
    return `${p.interval === 2 ? 'Every other' : 'Every'} ${joinList(names)}`;
  }
  if (p?.kind === 'monthly') {
    const ords = [...p.nths].sort((a, b) => (a < 0 ? 9 : a) - (b < 0 ? 9 : b)).map(n => ORDINALS[n] ?? `${n}th`);
    const text = `${joinList(ords)} ${DAY_LONG[p.day]}`;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  try {
    const text = RRule.fromString(rrule).toText();
    return text.charAt(0).toUpperCase() + text.slice(1);
  } catch {
    return rrule;
  }
}

/** Full plain-English summary for the Kids view. */
export function describeActivity(a: Activity): string {
  const parts = [`${describeRule(a.rrule)}, ${formatTime(a.startTime)}–${formatTime(a.endTime)}`];
  if (a.skipOn.includes('no_school')) parts.push('skips days with no school');
  if (a.skipOn.includes('early_release')) parts.push('skips early release');
  if (a.endsOn) parts.push(`ends ${shortDate(a.endsOn)}`);
  return parts.join(' · ');
}
