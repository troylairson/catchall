/** A thin wrapper around tsdav so the sync logic can be tested with a fake server. */

import { createDAVClient, type DAVCalendar } from 'tsdav';

export const ICLOUD_CALDAV_URL = 'https://caldav.icloud.com';

export interface RemoteCalendar {
  url: string;
  name: string;
  color: string;
  ctag: string | null;
}

export interface CalDavClient {
  listCalendars(): Promise<RemoteCalendar[]>;
  /** The ICS text of every event in the calendar that touches the time range. */
  fetchIcs(calendarUrl: string, from: Date, to: Date): Promise<string[]>;
}

export type Connect = (serverUrl: string, username: string, password: string) => Promise<CalDavClient>;

/** Turns network and authentication failures into messages a person can act on. */
export function friendlyError(err: unknown): string {
  const msg = String((err as Error)?.message ?? err);
  if (/401|unauthori[sz]ed|invalid credentials|forbidden|403/i.test(msg)) {
    return 'Apple didn’t accept the email or password. Use an app-specific password from appleid.apple.com, not your regular Apple ID password.';
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|fetch failed|network|timeout/i.test(msg)) {
    return 'Couldn’t reach iCloud. Check that the box is online; it will try again in a few minutes.';
  }
  return `iCloud sync failed: ${msg}`;
}

function nameOf(c: DAVCalendar): string {
  return typeof c.displayName === 'string' && c.displayName.trim() ? c.displayName.trim() : 'Calendar';
}

export const connectCalDav: Connect = async (serverUrl, username, password) => {
  const client = await createDAVClient({
    serverUrl,
    credentials: { username, password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
  let calendars: DAVCalendar[] = [];

  return {
    async listCalendars() {
      calendars = (await client.fetchCalendars())
        // Skip Reminders lists, which only hold tasks.
        .filter(c => !c.components || c.components.includes('VEVENT'));
      return calendars.map(c => ({
        url: c.url,
        name: nameOf(c),
        color: typeof c.calendarColor === 'string' ? c.calendarColor.slice(0, 7) : '',
        ctag: c.ctag ?? null,
      }));
    },
    async fetchIcs(calendarUrl, from, to) {
      const calendar = calendars.find(c => c.url === calendarUrl) ?? ({ url: calendarUrl } as DAVCalendar);
      const objects = await client.fetchCalendarObjects({
        calendar,
        timeRange: { start: from.toISOString(), end: to.toISOString() },
      });
      return objects.map(o => (typeof o.data === 'string' ? o.data : '')).filter(Boolean);
    },
  };
};
