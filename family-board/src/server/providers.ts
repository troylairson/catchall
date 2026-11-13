/** What the sync job needs from a calendar service (iCloud or Google). */

import type { ParsedEvent } from './ics';

export interface RemoteCalendar {
  /** The service's ID for the calendar: a CalDAV URL for iCloud, a calendar ID for Google. */
  url: string;
  name: string;
  color: string;
  /** Changes whenever anything in the calendar changes; null when the service has none. */
  ctag: string | null;
  /** Whether a newly found calendar starts out shown. Defaults to true. */
  enabledByDefault?: boolean;
}

export interface ProviderSession {
  listCalendars(): Promise<RemoteCalendar[]>;
  /** Events touching `from`–`to` (inclusive dates), with repeats already expanded. */
  fetchEvents(calendarUrl: string, from: string, to: string, householdTz: string): Promise<ParsedEvent[]>;
}
