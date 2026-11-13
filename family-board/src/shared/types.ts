/** Calendar dates are 'YYYY-MM-DD' strings and times are 'HH:mm' (24-hour), both in the
 *  household time zone, unless a field says it is an ISO instant. */

export type Role = 'parent' | 'kid';

export interface Person {
  id: string;
  name: string;
  /** Base color as #rrggbb. Tints are derived from it. */
  color: string;
  /** Shown in the avatar instead of the initial when set. */
  emoji: string;
  role: Role;
  sortOrder: number;
  /** Extra words that assign a shared-calendar event to this person (e.g. "🏀"). */
  keywords: string[];
}

export type SchoolDayKind = 'no_school' | 'early_release' | 'info';

export interface SchoolDay {
  date: string;
  kind: SchoolDayKind;
  label: string;
  source: 'district' | 'manual';
}

export interface SchoolYear {
  firstStudentDay: string;
  lastStudentDay: string;
}

/** A recurring kid activity, stored as a rule rather than as calendar events. */
export interface Activity {
  id: string;
  personId: string;
  name: string;
  icon: string;
  /** RFC 5545 RRULE body without DTSTART, e.g. "FREQ=WEEKLY;BYDAY=TU,TH". */
  rrule: string;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
  /** School-day kinds on which this activity does not happen. */
  skipOn: Array<'no_school' | 'early_release'>;
  startsOn: string;
  endsOn: string | null;
  demo?: boolean;
}

export type ExceptionKind = 'cancel' | 'move' | 'note';

export interface ActivityException {
  id: string;
  activityId: string;
  /** The date of the regular occurrence this exception changes. */
  date: string;
  kind: ExceptionKind;
  newDate?: string | null;
  newStartTime?: string | null;
  newEndTime?: string | null;
  newLocation?: string | null;
  note?: string | null;
}

export type OccurrenceStatus = 'on' | 'skipped' | 'cancelled' | 'moved';

export interface Occurrence {
  activityId: string;
  personId: string;
  name: string;
  icon: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  status: OccurrenceStatus;
  /** Why it isn't happening ("Thanksgiving Break"), or where it moved to. */
  reason?: string;
  note?: string;
  /** Set when this occurrence was moved here from another date or time. */
  movedFrom?: string;
}

export interface ActivityAnswer {
  activityId: string;
  today: Occurrence | null;
  happening: boolean;
  next: Occurrence | null;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  allDay: boolean;
  /** ISO instant for timed events; 'YYYY-MM-DD' for all-day events. */
  start: string;
  /** ISO instant for timed events; exclusive 'YYYY-MM-DD' for all-day events. */
  end: string;
  location: string;
  notes: string;
  /** Empty means the event belongs to the whole family. */
  personIds: string[];
  /** The UID from the source calendar, used to merge copies of one event. */
  externalUid?: string;
  demo?: boolean;
}

/** A connected calendar account. The password never leaves the server. */
export interface CalendarAccount {
  id: string;
  kind: 'icloud' | 'google';
  /** Whose account this is; their calendars go to their column by default. */
  personId: string;
  username: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

/** One calendar inside an account, e.g. "Home" or "Family". */
export interface CalendarSource {
  id: string;
  accountId: string;
  url: string;
  name: string;
  color: string;
  enabled: boolean;
  /** Whose column its events go to; null means Family (assigned by names in titles). */
  personId: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface SyncProblem {
  name: string;
  message: string;
}

/** Trip.personId for a trip the whole family takes, such as a vacation. */
export const EVERYONE = 'everyone';

export interface Trip {
  id: string;
  /** Who is away, or EVERYONE for the whole family. */
  personId: string;
  city: string;
  /** IANA time zone at the destination, e.g. "America/Denver". */
  tz: string;
  startsOn: string;
  endsOn: string;
  returnNote: string;
  demo?: boolean;
}

export interface Settings {
  timezone: string;
  latitude: number;
  longitude: number;
  placeName: string;
  dimStart: string;
  dimEnd: string;
  idleMinutes: number;
}

export interface Weather {
  temperature: number;
  high: number;
  low: number;
  description: string;
  fetchedAt: string;
}

export interface Board {
  /** Today's date in the household time zone, according to the server. */
  today: string;
  from: string;
  to: string;
  settings: Settings;
  people: Person[];
  events: CalendarEvent[];
  occurrences: Occurrence[];
  activities: Activity[];
  answers: ActivityAnswer[];
  schoolDays: SchoolDay[];
  schoolYear: SchoolYear | null;
  trips: Trip[];
  exceptions: ActivityException[];
  weather: Weather | null;
  hasDemoData: boolean;
  /** Calendars that failed or haven't synced in over an hour. */
  syncProblems: SyncProblem[];
}
