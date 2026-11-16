import { useEffect, useState } from 'react';
import { EVERYONE, type Board, type CalendarEvent } from '../../shared/types';
import { formatTime, shortDate, toZoned } from '../../shared/dates';
import { api } from '../api';

/** Events added by hand, such as the days a kid buys lunch at school. */
export function ManualEventsCard({ board }: { board: Board }) {
  const kids = board.people.filter(p => p.role === 'kid');
  const [personId, setPersonId] = useState(kids[0]?.id ?? board.people[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(board.today);
  const [dates, setDates] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const tz = board.settings.timezone;

  useEffect(() => {
    api<{ events: CalendarEvent[] }>('GET', '/api/manual-events').then(r => setEvents(r.events)).catch(() => {});
  }, [board]);

  const addDate = () => {
    if (date && !dates.includes(date)) setDates([...dates, date].sort());
  };
  // The date in the picker counts even if "Add another date" wasn't pressed.
  const allDates = [...new Set([...dates, ...(date ? [date] : [])])].sort();

  const who = (e: CalendarEvent) =>
    e.personIds.length ? e.personIds.map(id => board.people.find(p => p.id === id)?.name ?? '').join(', ') : 'Everyone';
  const when = (e: CalendarEvent) => {
    if (e.allDay) return shortDate(e.start);
    const z = toZoned(e.start, tz);
    return `${shortDate(z.date)}, ${formatTime(z.time)}`;
  };

  return (
    <section className="card">
      <h2>Events</h2>
      <p className="hint">
        Add one-off things that aren’t on a calendar, like the days Lincoln buys lunch. Pick several dates to add them all
        at once. For something every week, use Activities instead.
      </p>
      <form className="grid-form" onSubmit={async e => {
        e.preventDefault();
        setMsg(null);
        try {
          const r = await api<{ events: CalendarEvent[] }>('POST', '/api/manual-events', {
            personId, title, dates: allDates, startTime: startTime || undefined, endTime: endTime || undefined, location,
          });
          setMsg({ text: `Added ${title.trim()} on ${r.events.length} ${r.events.length === 1 ? 'day' : 'days'}.` });
          setTitle(''); setDates([]); setStartTime(''); setEndTime(''); setLocation('');
        } catch (err) { setMsg({ text: (err as Error).message, error: true }); }
      }}>
        <div className="field"><label htmlFor="me-who">Who</label>
          <select id="me-who" value={personId} onChange={e => setPersonId(e.target.value)}>
            {board.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value={EVERYONE}>Everyone</option>
          </select></div>
        <div className="field"><label htmlFor="me-title">What</label>
          <input id="me-title" value={title} placeholder="Buys lunch" onChange={e => setTitle(e.target.value)} /></div>
        <div className="field span-all">
          <label htmlFor="me-date">Date</label>
          <div className="row wrap">
            <input id="me-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
            <button type="button" onClick={addDate} disabled={!date}>Add another date</button>
          </div>
          {allDates.length > 1 && (
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
        <div className="field"><label htmlFor="me-start">Starts at (optional)</label>
          <input id="me-start" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} /></div>
        <div className="field"><label htmlFor="me-end">Ends at (optional)</label>
          <input id="me-end" type="time" value={endTime} disabled={!startTime} onChange={e => setEndTime(e.target.value)} /></div>
        <div className="field span-all"><label htmlFor="me-where">Where (optional)</label>
          <input id="me-where" value={location} onChange={e => setLocation(e.target.value)} /></div>
        <div className="row span-all">
          <button className="primary" disabled={!title.trim() || allDates.length === 0}>
            {allDates.length > 1 ? `Add to ${allDates.length} days` : 'Add event'}
          </button>
        </div>
        {msg && <p className={`status span-all${msg.error ? ' error' : ''}`} role="status">{msg.text}</p>}
      </form>

      <h3>Coming up</h3>
      <ul className="plain-list">
        {events.length === 0 && <li className="muted">No events added yet.</li>}
        {events.map(e => (
          <li key={e.id}>
            <span>{who(e)}: {e.title}</span>
            <span className="muted">{when(e)}{e.location ? ` · ${e.location}` : ''}</span>
            <button className="link-btn" onClick={() => void api('DELETE', `/api/manual-events/${e.id}`)}>Remove</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
