/** Date helpers. Calendar dates are 'YYYY-MM-DD' strings handled in UTC so that
 *  daylight-saving changes never shift a day. */

const DAY_MS = 86_400_000;

export function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return formatDate(new Date(parseDate(date).getTime() + n * DAY_MS));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  return parseDate(date).getUTCDay();
}

/** The Monday on or before `date`. */
export function startOfWeek(date: string): string {
  return addDays(date, -((weekday(date) + 6) % 7));
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

export function weekdayName(date: string, short = false): string {
  const n = WEEKDAYS[weekday(date)];
  return short ? n.slice(0, 3) : n;
}

export function monthName(date: string, short = false): string {
  const n = MONTHS[parseDate(date).getUTCMonth()];
  return short ? n.slice(0, 3) : n;
}

export function dayOfMonth(date: string): number {
  return parseDate(date).getUTCDate();
}

/** "Tue, Nov 17" */
export function shortDate(date: string): string {
  return `${weekdayName(date, true)}, ${monthName(date, true)} ${dayOfMonth(date)}`;
}

/** "3:15 PM" from "15:15". */
export function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function zonedParts(instant: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

/** The wall-clock date and time of an instant in a time zone. */
export function toZoned(instant: Date | string, tz: string): { date: string; time: string; minutes: number } {
  const p = zonedParts(typeof instant === 'string' ? new Date(instant) : instant, tz);
  const date = `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  const time = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
  return { date, time, minutes: p.h * 60 + p.mi };
}

function offsetMinutes(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** The instant at which the wall clock in `tz` reads `date` `time`. */
export function fromZoned(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetMinutes(new Date(guess), tz);
  const t = guess - first * 60000;
  const second = offsetMinutes(new Date(t), tz);
  return new Date(second === first ? t : guess - second * 60000);
}

/** Short zone name such as "MT" or "ET", for showing a traveler's local time. */
export function zoneAbbrev(tz: string, at: Date = new Date()): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(at).find(p => p.type === 'timeZoneName')?.value ?? tz;
  const m = name.match(/^([A-Z])[SD]T$/);
  return m ? `${m[1]}T` : name;
}
