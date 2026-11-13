import { describe, expect, it } from 'vitest';
import type { Activity, ActivityException, SchoolDay } from '../types';
import {
  answerFor, buildRule, describeActivity, describeRule, expandDates, makeContext, occurrencesFor,
  parsePreset, schoolStatus,
} from '../recurrence';
import school from '../../../data/school-calendar-2026-27.json';
import { expandSchoolCalendar } from '../school';

const schoolDays: SchoolDay[] = expandSchoolCalendar(school);
const year = { firstStudentDay: school.firstStudentDay, lastStudentDay: school.lastStudentDay };

function activity(over: Partial<Activity> = {}): Activity {
  return {
    id: 'chess', personId: 'lincoln', name: 'Chess club', icon: '♟️',
    rrule: 'FREQ=WEEKLY;BYDAY=TU,TH', startTime: '15:15', endTime: '16:30',
    location: 'Room 204', notes: '', skipOn: ['no_school'], startsOn: '2026-09-01', endsOn: '2026-12-17',
    ...over,
  };
}

const ctx = (exceptions: ActivityException[] = []) => makeContext(schoolDays, year, exceptions);

describe('expandDates', () => {
  it('produces Tuesdays and Thursdays in range', () => {
    expect(expandDates(activity(), '2026-11-09', '2026-11-15')).toEqual(['2026-11-10', '2026-11-12']);
  });

  it('stops at the end date', () => {
    expect(expandDates(activity(), '2026-12-14', '2026-12-31')).toEqual(['2026-12-15', '2026-12-17']);
  });

  it('handles 2nd and 4th Thursday', () => {
    const scouts = activity({ rrule: 'FREQ=MONTHLY;BYDAY=2TH,4TH', startsOn: '2026-08-01', endsOn: null });
    expect(expandDates(scouts, '2026-11-01', '2026-12-31'))
      .toEqual(['2026-11-12', '2026-11-26', '2026-12-10', '2026-12-24']);
  });

  it('handles every other week from the start date', () => {
    const a = activity({ rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', startsOn: '2026-11-02', endsOn: null });
    expect(expandDates(a, '2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-16', '2026-11-30']);
  });
});

describe('school calendar', () => {
  it('knows Thanksgiving break, including the Monday after', () => {
    const c = ctx();
    expect(schoolStatus('2026-11-25', c)?.label).toBe('Thanksgiving Break');
    expect(schoolStatus('2026-11-30', c)?.kind).toBe('no_school');
    expect(schoolStatus('2026-12-01', c)).toBeNull();
  });

  it('treats summer as no school', () => {
    expect(schoolStatus('2027-06-10', ctx())?.label).toBe('Summer break');
  });

  it('ignores info-only days such as end of quarter', () => {
    expect(schoolStatus('2027-01-08', ctx())).toBeNull();
  });
});

describe('occurrencesFor', () => {
  it('skips Election Day for a Tuesday activity', () => {
    const occ = occurrencesFor(activity(), '2026-11-03', '2026-11-03', ctx());
    expect(occ).toHaveLength(1);
    expect(occ[0]).toMatchObject({ status: 'skipped', reason: 'Election Day, teacher PD (no students)' });
  });

  it('does not skip when the activity ignores the school calendar', () => {
    const a = activity({ skipOn: [] });
    expect(occurrencesFor(a, '2026-11-03', '2026-11-03', ctx())[0].status).toBe('on');
  });

  it('skips a 4th-Thursday activity on Thanksgiving', () => {
    const scouts = activity({ rrule: 'FREQ=MONTHLY;BYDAY=2TH,4TH', endsOn: null });
    const occ = occurrencesFor(scouts, '2026-11-26', '2026-11-26', ctx());
    expect(occ[0]).toMatchObject({ status: 'skipped', reason: 'Thanksgiving Break' });
  });

  it('cancels one date', () => {
    const c = ctx([{ id: 'x', activityId: 'chess', date: '2026-11-12', kind: 'cancel', note: 'Coach out sick' }]);
    expect(occurrencesFor(activity(), '2026-11-12', '2026-11-12', c)[0])
      .toMatchObject({ status: 'cancelled', reason: 'Coach out sick' });
  });

  it('moves one date to another day', () => {
    const c = ctx([{ id: 'x', activityId: 'chess', date: '2026-11-17', kind: 'move', newDate: '2026-11-18' }]);
    const occ = occurrencesFor(activity(), '2026-11-16', '2026-11-22', c);
    expect(occ.map(o => [o.date, o.status])).toEqual([
      ['2026-11-17', 'moved'], ['2026-11-18', 'on'], ['2026-11-19', 'on'],
    ]);
    expect(occ[0].reason).toBe('Moved to Wed, Nov 18');
    expect(occ[1].movedFrom).toBe('2026-11-17');
  });

  it('changes the time on the same day', () => {
    const c = ctx([{ id: 'x', activityId: 'chess', date: '2026-11-19', kind: 'move', newStartTime: '16:00', newEndTime: '17:00' }]);
    const [occ] = occurrencesFor(activity(), '2026-11-19', '2026-11-19', c);
    expect(occ).toMatchObject({ status: 'on', startTime: '16:00', endTime: '17:00' });
  });

  it('adds a note for one date', () => {
    const c = ctx([{ id: 'x', activityId: 'chess', date: '2026-11-19', kind: 'note', note: 'Tournament, bring lunch' }]);
    expect(occurrencesFor(activity(), '2026-11-19', '2026-11-19', c)[0].note).toBe('Tournament, bring lunch');
  });
});

describe('answerFor', () => {
  it('says no on a Friday and gives the next Tuesday', () => {
    const a = answerFor(activity(), '2026-11-13', ctx());
    expect(a.happening).toBe(false);
    expect(a.today).toBeNull();
    expect(a.next?.date).toBe('2026-11-17');
  });

  it('says yes on a Thursday', () => {
    const a = answerFor(activity(), '2026-11-12', ctx());
    expect(a.happening).toBe(true);
    expect(a.today?.startTime).toBe('15:15');
  });

  it('jumps over Thanksgiving to the next real date', () => {
    const scouts = activity({ rrule: 'FREQ=MONTHLY;BYDAY=2TH,4TH', endsOn: null });
    expect(answerFor(scouts, '2026-11-13', ctx()).next?.date).toBe('2026-12-10');
  });

  it('jumps over winter break', () => {
    const a = activity({ endsOn: null });
    expect(answerFor(a, '2026-12-18', ctx()).next?.date).toBe('2027-01-05');
  });

  it('has no next date after the activity ends', () => {
    expect(answerFor(activity(), '2026-12-18', ctx()).next).toBeNull();
  });
});

describe('rule text and presets', () => {
  it('describes common rules', () => {
    expect(describeRule('FREQ=WEEKLY;BYDAY=TU,TH')).toBe('Every Tue & Thu');
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO')).toBe('Every Monday');
    expect(describeRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=SA')).toBe('Every other Saturday');
    expect(describeRule('FREQ=MONTHLY;BYDAY=2TH,4TH')).toBe('2nd & 4th Thursday');
    expect(describeRule('FREQ=MONTHLY;BYDAY=-1FR')).toBe('Last Friday');
  });

  it('round-trips presets', () => {
    const weekly = buildRule({ kind: 'weekly', days: [3, 1], interval: 1 });
    expect(weekly).toBe('FREQ=WEEKLY;BYDAY=TU,TH');
    expect(parsePreset(weekly)).toEqual({ kind: 'weekly', days: [1, 3], interval: 1 });
    const monthly = buildRule({ kind: 'monthly', nths: [4, 2], day: 3 });
    expect(monthly).toBe('FREQ=MONTHLY;BYDAY=2TH,4TH');
    expect(parsePreset(monthly)).toEqual({ kind: 'monthly', nths: [2, 4], day: 3 });
  });

  it('summarizes an activity', () => {
    expect(describeActivity(activity()))
      .toBe('Every Tue & Thu, 3:15 PM–4:30 PM · skips days with no school · ends Thu, Dec 17');
  });
});
