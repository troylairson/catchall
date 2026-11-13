import type { SchoolDay, SchoolDayKind, SchoolYear } from './types';
import { dateRange } from './dates';

/** The shape of a transcribed district calendar in data/. */
export interface SchoolCalendarFile {
  district: string;
  schoolYear: string;
  firstStudentDay: string;
  lastStudentDay: string;
  days: Array<{ start: string; end: string; kind: string; label: string }>;
}

/** One SchoolDay per date, from the file's date ranges. */
export function expandSchoolCalendar(file: SchoolCalendarFile): SchoolDay[] {
  return file.days.flatMap(r =>
    dateRange(r.start, r.end).map(date => ({
      date, kind: r.kind as SchoolDayKind, label: r.label, source: 'district' as const,
    })));
}

export function schoolYearOf(file: SchoolCalendarFile): SchoolYear {
  return { firstStudentDay: file.firstStudentDay, lastStudentDay: file.lastStudentDay };
}
