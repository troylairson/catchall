import { describe, expect, it } from 'vitest';
import { parseIcs } from '../ics';

const TZ = 'America/New_York';
const cal = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test', ...events, 'END:VCALENDAR'].join('\r\n');
const ev = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');

describe('parseIcs', () => {
  it('reads a timed event in another time zone', () => {
    const [e] = parseIcs(cal(ev(
      'UID:1', 'SUMMARY:Client workshop', 'LOCATION:Denver office',
      'DTSTART;TZID=America/Denver:20261113T090000', 'DTEND;TZID=America/Denver:20261113T160000',
    )), '2026-11-09', '2026-11-15', TZ);
    // 9:00 AM Mountain is 4:00 PM UTC.
    expect(e).toMatchObject({
      uid: '1', title: 'Client workshop', allDay: false, location: 'Denver office',
      start: '2026-11-13T16:00:00.000Z', end: '2026-11-13T23:00:00.000Z',
    });
  });

  it('reads UTC times and floating times', () => {
    const events = parseIcs(cal(
      ev('UID:utc', 'SUMMARY:UTC', 'DTSTART:20261113T150000Z', 'DTEND:20261113T160000Z'),
      ev('UID:float', 'SUMMARY:Floating', 'DTSTART:20261113T150000', 'DTEND:20261113T160000'),
    ), '2026-11-09', '2026-11-15', TZ);
    expect(events.find(e => e.uid === 'utc')?.start).toBe('2026-11-13T15:00:00.000Z');
    // Floating times are household time: 3 PM Eastern is 8 PM UTC.
    expect(events.find(e => e.uid === 'float')?.start).toBe('2026-11-13T20:00:00.000Z');
  });

  it('maps Windows zone names from Outlook invitations', () => {
    const [e] = parseIcs(cal(ev(
      'UID:w', 'SUMMARY:Call', 'DTSTART;TZID=Pacific Standard Time:20261113T090000',
      'DTEND;TZID=Pacific Standard Time:20261113T093000',
    )), '2026-11-09', '2026-11-15', TZ);
    expect(e.start).toBe('2026-11-13T17:00:00.000Z');
  });

  it('reads all-day and multi-day events with exclusive end dates', () => {
    const events = parseIcs(cal(
      ev('UID:a', 'SUMMARY:Pizza night', 'DTSTART;VALUE=DATE:20261113', 'DTEND;VALUE=DATE:20261114'),
      ev('UID:b', 'SUMMARY:Denver trip', 'DTSTART;VALUE=DATE:20261112', 'DTEND;VALUE=DATE:20261116'),
      ev('UID:c', 'SUMMARY:No end', 'DTSTART;VALUE=DATE:20261110'),
    ), '2026-11-09', '2026-11-15', TZ);
    expect(events.find(e => e.uid === 'a')).toMatchObject({ allDay: true, start: '2026-11-13', end: '2026-11-14' });
    expect(events.find(e => e.uid === 'b')).toMatchObject({ start: '2026-11-12', end: '2026-11-16' });
    expect(events.find(e => e.uid === 'c')).toMatchObject({ start: '2026-11-10', end: '2026-11-11' });
  });

  it('expands repeats inside the window, with skipped and moved dates', () => {
    const events = parseIcs(cal(
      ev('UID:r', 'SUMMARY:Standup', 'DTSTART;TZID=America/New_York:20260105T090000',
        'DTEND;TZID=America/New_York:20260105T093000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
        'EXDATE;TZID=America/New_York:20261111T090000'),
      ev('UID:r', 'RECURRENCE-ID;TZID=America/New_York:20261116T090000', 'SUMMARY:Standup (moved)',
        'DTSTART;TZID=America/New_York:20261116T130000', 'DTEND;TZID=America/New_York:20261116T133000'),
    ), '2026-11-09', '2026-11-18', TZ);
    expect(events.map(e => [e.title, e.start])).toEqual([
      ['Standup', '2026-11-09T14:00:00.000Z'],
      ['Standup (moved)', '2026-11-16T18:00:00.000Z'],
      ['Standup', '2026-11-18T14:00:00.000Z'],
    ]);
  });

  it('keeps the wall-clock time across a daylight-saving change', () => {
    const events = parseIcs(cal(ev(
      'UID:d', 'SUMMARY:Swim', 'DTSTART;TZID=America/New_York:20261026T163000',
      'DTEND;TZID=America/New_York:20261026T171500', 'RRULE:FREQ=WEEKLY;COUNT=2',
    )), '2026-10-01', '2026-11-30', TZ);
    // 4:30 PM EDT, then 4:30 PM EST a week later (clocks changed Nov 1).
    expect(events.map(e => e.start)).toEqual(['2026-10-26T20:30:00.000Z', '2026-11-02T21:30:00.000Z']);
  });

  it('skips cancelled events and occurrences', () => {
    const events = parseIcs(cal(
      ev('UID:x', 'SUMMARY:Gone', 'STATUS:CANCELLED', 'DTSTART:20261113T150000Z', 'DTEND:20261113T160000Z'),
      ev('UID:y', 'SUMMARY:Weekly', 'DTSTART:20261109T150000Z', 'DTEND:20261109T160000Z', 'RRULE:FREQ=WEEKLY;COUNT=2'),
      ev('UID:y', 'RECURRENCE-ID:20261116T150000Z', 'SUMMARY:Weekly', 'STATUS:CANCELLED',
        'DTSTART:20261116T150000Z', 'DTEND:20261116T160000Z'),
    ), '2026-11-01', '2026-11-30', TZ);
    expect(events.map(e => [e.uid, e.start])).toEqual([['y', '2026-11-09T15:00:00.000Z']]);
  });

  it('ignores events outside the window and broken files', () => {
    expect(parseIcs(cal(ev('UID:old', 'SUMMARY:Old', 'DTSTART:20250101T150000Z', 'DTEND:20250101T160000Z')),
      '2026-11-09', '2026-11-15', TZ)).toEqual([]);
    expect(parseIcs('not a calendar', '2026-11-09', '2026-11-15', TZ)).toEqual([]);
  });
});
