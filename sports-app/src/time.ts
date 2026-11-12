const TZ = 'America/New_York';

const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const dowFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });

/** YYYY-MM-DD in Eastern time. */
export const easternDay = (d: Date | string | number) => dayKeyFmt.format(new Date(d));

export const easternTime = (d: Date | string | number) => `${timeFmt.format(new Date(d))} ET`;

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/**
 * "Tonight 7:00 PM ET", "Today 1:00 PM ET", "Tomorrow 8:20 PM ET", "Sat 1:00 PM ET",
 * "Sun, Nov 22 · 1:00 PM ET". With timeTBD the time is dropped.
 */
export function whenLabel(iso: string, now = new Date(), timeTBD = false): string {
  const d = new Date(iso);
  const diff = dayDiff(easternDay(d), easternDay(now));
  const time = timeTBD ? 'time TBD' : easternTime(d);
  if (diff === 0) {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(d));
    return `${!timeTBD && hour >= 17 ? 'Tonight' : 'Today'} ${time}`;
  }
  if (diff === 1) return `Tomorrow ${time}`;
  if (diff > 1 && diff < 7) return `${dowFmt.format(d)} ${time}`;
  return `${dateFmt.format(d)} · ${time}`;
}

/** "Yesterday", "Sun", "Oct 19". For results. */
export function agoLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const diff = dayDiff(easternDay(now), easternDay(d));
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return dowFmt.format(d);
  return shortDateFmt.format(d);
}

export const longDate = (iso: string) => dateFmt.format(new Date(iso));

export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
