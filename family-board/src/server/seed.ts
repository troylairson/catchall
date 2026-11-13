/** First-run setup (people, settings, school calendar) and optional sample data. */

import type { Store } from './store';
import type { Person } from '../shared/types';
import { addDays, fromZoned, startOfWeek, toZoned } from '../shared/dates';
import { expandSchoolCalendar, schoolYearOf } from '../shared/school';
import schoolCalendar from '../../data/school-calendar-2026-27.json';

const FAMILY: Person[] = [
  { id: 'troy', name: 'Troy', color: '#2F6FB5', emoji: '', role: 'parent', sortOrder: 0, keywords: [] },
  { id: 'alexia', name: 'Alexia', color: '#C23A72', emoji: '', role: 'parent', sortOrder: 1, keywords: [] },
  { id: 'lincoln', name: 'Lincoln', color: '#23865B', emoji: '', role: 'kid', sortOrder: 2, keywords: [] },
  { id: 'everly', name: 'Everly', color: '#C67C00', emoji: '', role: 'kid', sortOrder: 3, keywords: [] },
];

/** Runs once per database. Loads sample data too unless DEMO_DATA=0. */
export function seedIfEmpty(store: Store, now = new Date()): void {
  if (store.getMeta('seeded')) return;
  store.transaction(() => {
    for (const p of FAMILY) store.savePerson(p);
    store.setMeta('seeded', now.toISOString());
  });
  store.replaceDistrictCalendar(expandSchoolCalendar(schoolCalendar), schoolYearOf(schoolCalendar));
  if (process.env.DEMO_DATA !== '0') loadDemoData(store, now);
}

/** Sample activities, events and a trip around the current week. All marked demo. */
export function loadDemoData(store: Store, now = new Date()): void {
  const tz = store.settings().timezone;
  const today = toZoned(now, tz).date;
  const mon = startOfWeek(today);
  const day = (n: number) => addDays(mon, n);
  const at = (n: number, time: string, zone = tz) => fromZoned(day(n), time, zone).toISOString();
  const timed = (personIds: string[], n: number, start: string, end: string, title: string, location = '', zone = tz) =>
    store.saveEvent({
      calendarId: 'sample', title, allDay: false, start: at(n, start, zone), end: at(n, end, zone),
      location, notes: '', personIds, demo: true,
    });

  store.clearDemoData();
  store.transaction(() => {
    const termStart = addDays(mon, -70);
    const act = (personId: string, name: string, icon: string, rrule: string, startTime: string,
      endTime: string, location: string, skip: boolean, endsOn: string | null = null) =>
      store.saveActivity({
        personId, name, icon, rrule, startTime, endTime, location, notes: '',
        skipOn: skip ? ['no_school'] : [], startsOn: termStart, endsOn, demo: true,
      });

    act('lincoln', 'Chess club', '♟️', 'FREQ=WEEKLY;BYDAY=TU,TH', '15:15', '16:30', 'Room 204', true, addDays(mon, 38));
    act('lincoln', 'Basketball practice', '🏀', 'FREQ=WEEKLY;BYDAY=MO,WE', '18:00', '19:30', 'Rec center gym', false);
    act('lincoln', 'Robotics', '🤖', 'FREQ=MONTHLY;BYDAY=1MO,3MO', '15:15', '17:00', 'STEM lab', true);
    act('everly', 'Art club', '🎨', 'FREQ=WEEKLY;BYDAY=WE,FR', '15:00', '16:15', 'Room 112', true, addDays(mon, 25));
    act('everly', 'Swim lessons', '🏊', 'FREQ=WEEKLY;BYDAY=MO', '16:30', '17:15', 'YMCA pool', false);
    act('everly', 'Girl Scouts', '🏕️', 'FREQ=MONTHLY;BYDAY=2TH,4TH', '18:00', '19:00', 'Library meeting room', true);

    timed(['troy'], 0, '19:00', '20:30', 'Book club', 'Ben’s house');
    timed(['troy'], 3, '08:00', '09:00', 'Dentist', 'Dr. Patel');
    timed(['troy'], 4, '12:00', '13:00', 'Lunch with Dan', 'Marco’s');
    timed(['troy'], 4, '16:15', '16:30', 'Pick up Everly', 'Art club, room 112');
    timed(['troy'], 5, '09:00', '10:30', 'Long run');
    timed(['troy'], 6, '18:40', '19:30', 'Airport pickup', 'CAK arrivals');
    timed(['alexia'], 0, '18:00', '19:00', 'Yoga', 'Studio on Main');
    timed(['alexia'], 1, '12:00', '13:00', 'Lunch with Jen');
    timed(['alexia'], 3, '07:10', '09:05', 'Flight to Denver', 'CAK → DEN');
    timed(['alexia'], 4, '09:00', '16:00', 'Client workshop', 'Denver office', 'America/Denver');
    timed(['alexia'], 4, '18:30', '20:30', 'Team dinner', 'Larimer Square', 'America/Denver');
    timed(['alexia'], 5, '09:00', '12:00', 'Workshop, day 2', 'Denver office', 'America/Denver');
    timed(['lincoln'], 4, '18:00', '19:30', 'Basketball game', 'Westfield MS · wear white');
    timed(['everly'], 6, '13:00', '15:00', 'Harper’s birthday party', 'Jump Zone');
    timed(['lincoln', 'everly'], 2, '16:00', '16:45', 'Haircuts', 'Main St Barbers');
    store.saveEvent({
      calendarId: 'sample', title: '🍕 Pizza night', allDay: true, start: day(4), end: day(5),
      location: '', notes: '', personIds: [], demo: true,
    });

    store.saveTrip({
      personId: 'alexia', city: 'Denver', tz: 'America/Denver', startsOn: day(3), endsOn: day(6),
      returnNote: 'Flight home Sun 6:40 PM', demo: true,
    });
  });
}
