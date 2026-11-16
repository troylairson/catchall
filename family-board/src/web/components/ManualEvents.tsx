import { useEffect, useState } from 'react';
import { EVERYONE, type Board, type CalendarEvent, type EventSeries } from '../../shared/types';
import { formatTime, shortDate, toZoned, weekday } from '../../shared/dates';
import { buildRule, describeRule, type RulePreset } from '../../shared/recurrence';
import { api } from '../api';

type Repeat = 'none' | 'weekly' | 'biweekly' | 'monthly';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const NTHS: Array<[number, string]> = [[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [-1, 'Last']];

/** Monday = 0 … Sunday = 6, as the rule presets expect. */
const presetDay = (date: string) => (weekday(date) + 6) % 7;

function whoOf(board: Board, personIds: string[]): string {
  return personIds.length ? personIds.map(id => board.people.find(p => p.id === id)?.name ?? '').join(', ') : 'Everyone';
}

function SeriesRow({ board, series }: { board: Board; series: EventSeries }) {
  const [skipDate, setSkipDate] = useState('');
  const [confirm, setConfirm] = useState(false);
  const setSkips = (skipDates: string[]) => void api('PUT', `/api/event-series/${series.id}`, { skipDates });
  const time = series.startTime
    ? `${formatTime(series.startTime)}${series.endTime ? `–${formatTime(series.endTime)}` : ''}`
    : 'All day';
  const parts = [describeRule(series.rrule), time, `from ${shortDate(series.startsOn)}`];
  if (series.endsOn) parts.push(`until ${shortDate(series.endsOn)}`);
  if (series.skipNoSchool) parts.push('skips days with no school');

  return (
    <li className="series-row">
      <div className="series-main">
        <span>{whoOf(board, series.personIds)}: {series.title}</span>
        <span className="muted small">{parts.join(' · ')}{series.location ? ` · ${series.location}` : ''}</span>
        {series.skipDates.length > 0 && (
          <div className="date-chips" aria-label="Skipped dates">
            {series.skipDates.map(d => (
              <span key={d} className="date-chip skipped">
                Skipping {shortDate(d)}
                <button type="button" aria-label={`Don’t skip ${shortDate(d)}`} onClick={() => setSkips(series.skipDates.filter(x => x !== d))}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="row wrap series-actions">
        <label className="sr-only" htmlFor={`skip-${series.id}`}>Date to skip</label>
        <input id={`skip-${series.id}`} type="date" value={skipDate} onChange={e => setSkipDate(e.target.value)} />
        <button type="button" disabled={!skipDate} onClick={() => { setSkips([...series.skipDates, skipDate]); setSkipDate(''); }}>Skip this date</button>
        {!confirm
          ? <button type="button" className="link-btn danger-link" onClick={() => setConfirm(true)}>Remove</button>
          : <>
              <span>Remove every date?</span>
              <button type="button" className="danger" onClick={() => void api('DELETE', `/api/event-series/${series.id}`)}>Remove all</button>
              <button type="button" onClick={() => setConfirm(false)}>Keep</button>
            </>}
      </div>
    </li>
  );
}

/** Events added by hand, such as the days a kid buys lunch at school. */
export function ManualEventsCard({ board }: { board: Board }) {
  const kids = board.people.filter(p => p.role === 'kid');
  const [personId, setPersonId] = useState(kids[0]?.id ?? board.people[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(board.today);
  const [dates, setDates] = useState<string[]>([]);
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [days, setDays] = useState<number[]>([presetDay(board.today)]);
  const [nths, setNths] = useState<number[]>([1]);
  const [monthDay, setMonthDay] = useState(presetDay(board.today));
  const [endsOn, setEndsOn] = useState('');
  const [skipNoSchool, setSkipNoSchool] = useState(false);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [series, setSeries] = useState<EventSeries[]>([]);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const tz = board.settings.timezone;

  useEffect(() => {
    api<{ events: CalendarEvent[]; series: EventSeries[] }>('GET', '/api/manual-events')
      .then(r => { setEvents(r.events); setSeries(r.series); })
      .catch(() => {});
  }, [board]);

  const repeats = repeat !== 'none';
  const preset: RulePreset | null = repeat === 'monthly'
    ? (nths.length ? { kind: 'monthly', nths, day: monthDay } : null)
    : repeats && days.length ? { kind: 'weekly', days, interval: repeat === 'biweekly' ? 2 : 1 } : null;
  const rule = preset ? buildRule(preset) : '';

  const addDate = () => { if (date && !dates.includes(date)) setDates([...dates, date].sort()); };
  // The date in the picker counts even if "Add another date" wasn't pressed.
  const allDates = [...new Set([...dates, ...(date ? [date] : [])])].sort();
  const toggle = (list: number[], set: (v: number[]) => void, v: number) =>
    set(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const when = (e: CalendarEvent) => {
    if (e.allDay) return shortDate(e.start);
    const z = toZoned(e.start, tz);
    return `${shortDate(z.date)}, ${formatTime(z.time)}`;
  };

  const reset = () => {
    setTitle(''); setDates([]); setStartTime(''); setEndTime(''); setLocation(''); setEndsOn('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const common = { personId, title, startTime: startTime || undefined, endTime: endTime || undefined, location };
    try {
      if (repeats) {
        await api('POST', '/api/event-series', { ...common, rrule: rule, startsOn: date, endsOn: endsOn || null, skipNoSchool });
        setMsg({ text: `Added ${title.trim()} (${describeRule(rule)}).` });
      } else {
        const r = await api<{ events: CalendarEvent[] }>('POST', '/api/manual-events', { ...common, dates: allDates });
        setMsg({ text: `Added ${title.trim()} on ${r.events.length} ${r.events.length === 1 ? 'day' : 'days'}.` });
      }
      reset();
    } catch (err) { setMsg({ text: (err as Error).message, error: true }); }
  };

  const ready = !!title.trim() && (repeats ? !!rule && !!date : allDates.length > 0);

  return (
    <section className="card">
      <h2>Events</h2>
      <p className="hint">
        Add things that aren’t on a calendar, like the days Lincoln buys lunch. Pick several dates to add them all at
        once, or make it repeat.
      </p>
      <form className="grid-form" onSubmit={submit}>
        <div className="field"><label htmlFor="me-who">Who</label>
          <select id="me-who" value={personId} onChange={e => setPersonId(e.target.value)}>
            {board.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value={EVERYONE}>Everyone</option>
          </select></div>
        <div className="field"><label htmlFor="me-title">What</label>
          <input id="me-title" value={title} placeholder="Buys lunch" onChange={e => setTitle(e.target.value)} /></div>

        <fieldset className="field span-all">
          <legend>Repeats</legend>
          <div className="segmented" role="radiogroup" aria-label="Repeats">
            {([['none', 'Doesn’t repeat'], ['weekly', 'Every week'], ['biweekly', 'Every other week'], ['monthly', 'Monthly']] as Array<[Repeat, string]>).map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={repeat === v} aria-pressed={repeat === v} onClick={() => setRepeat(v)}>{label}</button>
            ))}
          </div>
          {(repeat === 'weekly' || repeat === 'biweekly') && (
            <div className="day-picker" role="group" aria-label="Days">
              {DAYS.map((d, i) => <button key={d} type="button" aria-pressed={days.includes(i)} onClick={() => toggle(days, setDays, i)}>{d}</button>)}
            </div>
          )}
          {repeat === 'monthly' && (
            <div className="row wrap">
              <div className="day-picker" role="group" aria-label="Which weeks">
                {NTHS.map(([n, label]) => <button key={n} type="button" aria-pressed={nths.includes(n)} onClick={() => toggle(nths, setNths, n)}>{label}</button>)}
              </div>
              <select aria-label="Day of the week" value={monthDay} onChange={e => setMonthDay(Number(e.target.value))}>
                {DAY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
              </select>
            </div>
          )}
          {repeats && rule && <p className="hint">{describeRule(rule)}</p>}
        </fieldset>

        <div className="field span-all">
          <label htmlFor="me-date">{repeats ? 'Starts on' : 'Date'}</label>
          <div className="row wrap">
            <input id="me-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
            {!repeats && <button type="button" onClick={addDate} disabled={!date}>Add another date</button>}
          </div>
          {!repeats && allDates.length > 1 && (
            <div className="date-chips" aria-label="Dates">
              {allDates.map(d => (
                <span key={d} className="date-chip">
                  {shortDate(d)}
                  <button type="button" aria-label={`Remove ${shortDate(d)}`} onClick={() => {
                    setDates(dates.filter(x => x !== d));
                    if (d === date) setDate('');
                  }}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>
        {repeats && <>
          <div className="field"><label htmlFor="me-until">Ends on (optional)</label>
            <input id="me-until" type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} /></div>
          <label className="check span-all">
            <input type="checkbox" checked={skipNoSchool} onChange={e => setSkipNoSchool(e.target.checked)} />
            Skip days with no school (breaks, holidays, snow days, summer)
          </label>
        </>}
        <div className="field"><label htmlFor="me-start">Starts at (optional)</label>
          <input id="me-start" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} /></div>
        <div className="field"><label htmlFor="me-end">Ends at (optional)</label>
          <input id="me-end" type="time" value={endTime} disabled={!startTime} onChange={e => setEndTime(e.target.value)} /></div>
        <div className="field span-all"><label htmlFor="me-where">Where (optional)</label>
          <input id="me-where" value={location} onChange={e => setLocation(e.target.value)} /></div>
        <div className="row span-all">
          <button className="primary" disabled={!ready}>
            {repeats ? 'Add repeating event' : allDates.length > 1 ? `Add to ${allDates.length} days` : 'Add event'}
          </button>
        </div>
        {msg && <p className={`status span-all${msg.error ? ' error' : ''}`} role="status">{msg.text}</p>}
      </form>

      {series.length > 0 && <>
        <h3>Repeating</h3>
        <ul className="plain-list series-list">
          {series.map(s => <SeriesRow key={s.id} board={board} series={s} />)}
        </ul>
      </>}

      <h3>Coming up</h3>
      <ul className="plain-list">
        {events.length === 0 && <li className="muted">No one-off events coming up.</li>}
        {events.map(e => (
          <li key={e.id}>
            <span>{whoOf(board, e.personIds)}: {e.title}</span>
            <span className="muted">{when(e)}{e.location ? ` · ${e.location}` : ''}</span>
            <button className="link-btn" onClick={() => void api('DELETE', `/api/manual-events/${e.id}`)}>Remove</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
