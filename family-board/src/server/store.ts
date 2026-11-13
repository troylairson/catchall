/** SQLite storage using Node's built-in node:sqlite. Column names match the shared
 *  TypeScript field names; arrays are stored as JSON and booleans as 0/1. */

import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type {
  Activity, ActivityException, CalendarEvent, Person, SchoolDay, SchoolYear, Settings, Trip,
} from '../shared/types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS person (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL, sortOrder INTEGER NOT NULL, keywords TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY, personId TEXT NOT NULL, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '',
  rrule TEXT NOT NULL, startTime TEXT NOT NULL, endTime TEXT NOT NULL, location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', skipOn TEXT NOT NULL DEFAULT '[]', startsOn TEXT NOT NULL,
  endsOn TEXT, demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS activityException (
  id TEXT PRIMARY KEY, activityId TEXT NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL,
  newDate TEXT, newStartTime TEXT, newEndTime TEXT, newLocation TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS schoolDay (
  date TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, source TEXT NOT NULL,
  PRIMARY KEY (date, label));
CREATE TABLE IF NOT EXISTS event (
  id TEXT PRIMARY KEY, calendarId TEXT NOT NULL, title TEXT NOT NULL, allDay INTEGER NOT NULL,
  start TEXT NOT NULL, "end" TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  personIds TEXT NOT NULL DEFAULT '[]', demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS trip (
  id TEXT PRIMARY KEY, personId TEXT NOT NULL, city TEXT NOT NULL, tz TEXT NOT NULL,
  startsOn TEXT NOT NULL, endsOn TEXT NOT NULL, returnNote TEXT NOT NULL DEFAULT '',
  demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS event_start ON event (start);
`;

// Loaded through require because Vite and Vitest don't recognize node:sqlite yet.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

type Row = Record<string, unknown>;
type SqlValue = string | number | null;

const JSON_FIELDS = new Set(['keywords', 'skipOn', 'personIds']);
const BOOL_FIELDS = new Set(['allDay', 'demo']);

function encode(obj: object): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) out[k] = null;
    else if (Array.isArray(v)) out[k] = JSON.stringify(v);
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
    else out[k] = v as SqlValue;
  }
  return out;
}

function decode<T>(row: Row): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (JSON_FIELDS.has(k)) out[k] = JSON.parse(String(v ?? '[]'));
    else if (BOOL_FIELDS.has(k)) out[k] = v === 1;
    else out[k] = v;
  }
  return out as T;
}

export const DEFAULT_SETTINGS: Settings = {
  timezone: 'America/New_York',
  latitude: 40.9459,
  longitude: -81.4834,
  placeName: 'Green, OH',
  dimStart: '21:00',
  dimEnd: '06:30',
  idleMinutes: 3,
};

export class Store {
  readonly db: DatabaseSyncType;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  private all<T>(sql: string, params: Record<string, SqlValue> = {}): T[] {
    return (this.db.prepare(sql).all(params) as Row[]).map(r => decode<T>(r));
  }

  private put(table: string, obj: object): void {
    const row = encode(obj);
    const cols = Object.keys(row);
    const sql = `INSERT OR REPLACE INTO ${table} (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(c => `:${c}`).join(', ')})`;
    this.db.prepare(sql).run(row);
  }

  private remove(table: string, id: string): boolean {
    return Number(this.db.prepare(`DELETE FROM ${table} WHERE id = :id`).run({ id }).changes) > 0;
  }

  transaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try { fn(); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // meta
  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = :key').get({ key }) as Row | undefined;
    return row ? String(row.value) : null;
  }
  setMeta(key: string, value: string): void { this.put('meta', { key, value }); }

  // people
  people(): Person[] { return this.all<Person>('SELECT * FROM person ORDER BY sortOrder'); }
  person(id: string): Person | undefined { return this.people().find(p => p.id === id); }
  savePerson(p: Person): void { this.put('person', p); }

  // activities
  activities(): Activity[] { return this.all<Activity>('SELECT * FROM activity ORDER BY personId, name'); }
  activity(id: string): Activity | undefined {
    return this.all<Activity>('SELECT * FROM activity WHERE id = :id', { id })[0];
  }
  saveActivity(a: Omit<Activity, 'id'> & { id?: string }): Activity {
    const full = { ...a, id: a.id ?? randomUUID(), demo: a.demo ?? false } as Activity;
    this.put('activity', full);
    return full;
  }
  deleteActivity(id: string): boolean {
    this.db.prepare('DELETE FROM activityException WHERE activityId = :id').run({ id });
    return this.remove('activity', id);
  }

  // exceptions
  exceptions(): ActivityException[] { return this.all<ActivityException>('SELECT * FROM activityException ORDER BY date'); }
  saveException(e: Omit<ActivityException, 'id'> & { id?: string }): ActivityException {
    // One exception of each kind per activity and date; a new one replaces the old.
    this.db.prepare('DELETE FROM activityException WHERE activityId = :a AND date = :d AND kind = :k')
      .run({ a: e.activityId, d: e.date, k: e.kind });
    const full = { ...e, id: e.id ?? randomUUID() } as ActivityException;
    this.put('activityException', full);
    return full;
  }
  deleteException(id: string): boolean { return this.remove('activityException', id); }

  // school calendar
  schoolDays(): SchoolDay[] { return this.all<SchoolDay>('SELECT * FROM schoolDay ORDER BY date'); }
  saveSchoolDay(d: SchoolDay): void { this.put('schoolDay', d); }
  deleteManualSchoolDays(date: string): boolean {
    return Number(this.db.prepare("DELETE FROM schoolDay WHERE date = :date AND source = 'manual'").run({ date }).changes) > 0;
  }
  replaceDistrictCalendar(days: SchoolDay[], year: SchoolYear): void {
    this.transaction(() => {
      this.db.exec("DELETE FROM schoolDay WHERE source = 'district'");
      for (const d of days) this.saveSchoolDay(d);
      this.setMeta('schoolYear', JSON.stringify(year));
    });
  }
  schoolYear(): SchoolYear | null {
    const v = this.getMeta('schoolYear');
    return v ? JSON.parse(v) : null;
  }

  // events
  /** Events that might touch the range. Instants are UTC, so pad a day each side. */
  events(from: string, to: string): CalendarEvent[] {
    return this.all<CalendarEvent>(
      'SELECT * FROM event WHERE substr(start, 1, 10) <= :to AND substr("end", 1, 10) >= :from ORDER BY start',
      { from: padDate(from, -1), to: padDate(to, 1) });
  }
  saveEvent(e: Omit<CalendarEvent, 'id'> & { id?: string }): CalendarEvent {
    const full = { ...e, id: e.id ?? randomUUID(), demo: e.demo ?? false } as CalendarEvent;
    this.put('event', full);
    return full;
  }

  // trips
  trips(): Trip[] { return this.all<Trip>('SELECT * FROM trip ORDER BY startsOn'); }
  saveTrip(t: Omit<Trip, 'id'> & { id?: string }): Trip {
    const full = { ...t, id: t.id ?? randomUUID(), demo: t.demo ?? false } as Trip;
    this.put('trip', full);
    return full;
  }
  deleteTrip(id: string): boolean { return this.remove('trip', id); }

  // settings
  settings(): Settings {
    const rows = this.all<{ key: string; value: string }>('SELECT * FROM setting');
    const stored = Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
    return { ...DEFAULT_SETTINGS, ...stored };
  }
  saveSettings(patch: Partial<Settings>): Settings {
    for (const [key, value] of Object.entries(patch)) {
      if (key in DEFAULT_SETTINGS && value !== undefined) this.put('setting', { key, value: JSON.stringify(value) });
    }
    return this.settings();
  }

  // sample data
  hasDemoData(): boolean {
    const row = this.db.prepare(
      'SELECT (SELECT count(*) FROM activity WHERE demo = 1) + (SELECT count(*) FROM event WHERE demo = 1) + (SELECT count(*) FROM trip WHERE demo = 1) AS n',
    ).get() as Row;
    return Number(row.n) > 0;
  }
  clearDemoData(): void {
    this.transaction(() => {
      this.db.exec('DELETE FROM activityException WHERE activityId IN (SELECT id FROM activity WHERE demo = 1)');
      this.db.exec('DELETE FROM activity WHERE demo = 1; DELETE FROM event WHERE demo = 1; DELETE FROM trip WHERE demo = 1;');
    });
  }
}

function padDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
