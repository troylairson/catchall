import { useEffect, useState } from 'react';
import { EVERYONE, type Board, type Person, type Settings as SettingsT, type Trip } from '../../shared/types';
import { SWATCHES, colorWarning, isHexColor } from '../../shared/colors';
import { addDays, shortDate } from '../../shared/dates';
import { api } from '../api';
import { Avatar } from './Avatar';
import { CalendarsCard } from './Calendars';
import { setThemeChoice, useThemeChoice, type ThemeChoice } from '../theme';
import { formatTime } from '../../shared/dates';

/** Shows a short status message after a save, or the server's explanation of a problem. */
function useStatus() {
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); setMsg({ text: ok, error: false }); } catch (e) { setMsg({ text: (e as Error).message, error: true }); }
  };
  const view = msg && <p className={msg.error ? 'status error' : 'status'} role="status">{msg.text}</p>;
  return { run, view };
}

function PersonCard({ person }: { person: Person }) {
  const [draft, setDraft] = useState(person);
  const [keywords, setKeywords] = useState(person.keywords.join(', '));
  const { run, view } = useStatus();
  useEffect(() => { setDraft(person); setKeywords(person.keywords.join(', ')); }, [person]);
  const warning = colorWarning(draft.color);
  const id = `p-${person.id}`;

  return (
    <form className="card person-card" onSubmit={e => {
      e.preventDefault();
      void run(() => api('PUT', `/api/people/${person.id}`, {
        name: draft.name, color: draft.color, emoji: draft.emoji,
        keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
      }), 'Saved.');
    }}>
      <div className="person-card-head">
        <Avatar person={isHexColor(draft.color) ? draft : person} size="lg" />
        <div className="field grow">
          <label htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div className="field narrow">
          <label htmlFor={`${id}-emoji`}>Avatar emoji</label>
          <input id={`${id}-emoji`} value={draft.emoji} placeholder={draft.name.charAt(0)} onChange={e => setDraft({ ...draft, emoji: e.target.value })} />
        </div>
      </div>
      <fieldset className="field">
        <legend>Color</legend>
        <div className="swatches">
          {SWATCHES.map(s => (
            <button type="button" key={s} className="swatch" style={{ background: s }}
              aria-label={`Use ${s}`} aria-pressed={draft.color.toLowerCase() === s.toLowerCase()}
              onClick={() => setDraft({ ...draft, color: s })} />
          ))}
          <label className="swatch custom" title="Pick any color">
            <input id={`${id}-color`} type="color" value={isHexColor(draft.color) ? draft.color : '#000000'}
              onChange={e => setDraft({ ...draft, color: e.target.value.toUpperCase() })} aria-label="Pick any color" />
          </label>
        </div>
        {warning && <p className="hint warn">{warning}</p>}
      </fieldset>
      <div className="field">
        <label htmlFor={`${id}-kw`}>Words that mean {draft.name || 'this person'} on the shared calendar</label>
        <input id={`${id}-kw`} value={keywords} placeholder="e.g. 🏀, piano" onChange={e => setKeywords(e.target.value)} />
        <p className="hint">Their name always counts. Separate extra words with commas.</p>
      </div>
      <div className="row"><button className="primary">Save {draft.name || 'person'}</button>{view}</div>
    </form>
  );
}

function SchoolCard({ board }: { board: Board }) {
  const [date, setDate] = useState(board.today);
  const [label, setLabel] = useState('Snow day');
  const { run, view } = useStatus();
  const upcoming = board.schoolDays.filter(d => d.kind === 'no_school' && d.date >= board.today);
  // Collapse consecutive days with the same label into one line.
  const groups: Array<{ start: string; end: string; label: string; manual: boolean }> = [];
  for (const d of upcoming) {
    const last = groups[groups.length - 1];
    if (last && last.label === d.label && addDays(last.end, 1) === d.date) last.end = d.date;
    else groups.push({ start: d.date, end: d.date, label: d.label, manual: d.source === 'manual' });
  }

  return (
    <section className="card">
      <h2>School calendar</h2>
      <p className="hint">Green Local Schools, {board.schoolYear ? `last day ${shortDate(board.schoolYear.lastStudentDay)}` : 'no calendar loaded'}. Activities set to skip days with no school pause automatically.</p>
      <form className="row wrap" onSubmit={e => {
        e.preventDefault();
        void run(() => api('POST', '/api/school-days', { date, label }), `Marked ${shortDate(date)} as no school.`);
      }}>
        <div className="field"><label htmlFor="sd-date">Date</label><input id="sd-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div className="field grow"><label htmlFor="sd-label">Reason</label><input id="sd-label" value={label} onChange={e => setLabel(e.target.value)} /></div>
        <button className="primary">Mark no school</button>
      </form>
      {view}
      <h3>Coming up (next two months)</h3>
      <ul className="plain-list">
        {groups.length === 0 && <li className="muted">No days off in the next two months.</li>}
        {groups.map(g => (
          <li key={g.start + g.label}>
            <span>{shortDate(g.start)}{g.end !== g.start && ` – ${shortDate(g.end)}`}</span>
            <span className="muted">{g.label}</span>
            {g.manual && (
              <button className="link-btn" onClick={() => void run(() => api('DELETE', `/api/school-days/${g.start}`), 'Removed.')}>Remove</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const ZONES = [
  ['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'],
  ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'],
  ['Pacific/Honolulu', 'Hawaii'], ['Europe/London', 'London'], ['Europe/Paris', 'Central Europe'],
  ['Asia/Tokyo', 'Tokyo'],
];

function TripsCard({ board }: { board: Board }) {
  const parents = board.people.filter(p => p.role === 'parent');
  const blank = { personId: parents[0]?.id ?? '', city: '', tz: 'America/New_York', startsOn: board.today, endsOn: addDays(board.today, 2), returnNote: '' };
  const [draft, setDraft] = useState<Omit<Trip, 'id'>>(blank);
  const [trips, setTrips] = useState<Trip[]>([]);
  const { run, view } = useStatus();
  // The board only has this week's trips; load a wider range for this list.
  useEffect(() => {
    void api<Board>('GET', `/api/board?from=${board.today}&to=${addDays(board.today, 365)}`).then(b => setTrips(b.trips));
  }, [board]);

  return (
    <section className="card">
      <h2>Trips</h2>
      <p className="hint">While someone is away, the board shows where they are and counts the sleeps until they’re home. Choose Everyone for a family vacation. Activities for whoever is away are marked as not happening.</p>
      <ul className="plain-list">
        {trips.length === 0 && <li className="muted">No trips coming up.</li>}
        {trips.map(t => (
          <li key={t.id}>
            <span>{t.personId === EVERYONE ? 'Everyone' : board.people.find(p => p.id === t.personId)?.name} in {t.city}</span>
            <span className="muted">{shortDate(t.startsOn)} – {shortDate(t.endsOn)}{t.demo ? ' · sample' : ''}</span>
            <button className="link-btn" onClick={() => void run(() => api('DELETE', `/api/trips/${t.id}`), 'Trip removed.')}>Remove</button>
          </li>
        ))}
      </ul>
      <form className="grid-form" onSubmit={e => {
        e.preventDefault();
        void run(async () => { await api('POST', '/api/trips', draft); setDraft(blank); }, 'Trip added.');
      }}>
        <div className="field"><label htmlFor="t-who">Who</label>
          <select id="t-who" value={draft.personId} onChange={e => setDraft({ ...draft, personId: e.target.value })}>
            {board.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value={EVERYONE}>Everyone (family trip or vacation)</option>
          </select></div>
        <div className="field"><label htmlFor="t-city">City</label><input id="t-city" value={draft.city} placeholder="Denver" onChange={e => setDraft({ ...draft, city: e.target.value })} /></div>
        <div className="field"><label htmlFor="t-tz">Time zone there</label>
          <select id="t-tz" value={draft.tz} onChange={e => setDraft({ ...draft, tz: e.target.value })}>
            {ZONES.map(([z, n]) => <option key={z} value={z}>{n}</option>)}
          </select></div>
        <div className="field"><label htmlFor="t-start">Leaves</label><input id="t-start" type="date" value={draft.startsOn} onChange={e => setDraft({ ...draft, startsOn: e.target.value })} /></div>
        <div className="field"><label htmlFor="t-end">Home</label><input id="t-end" type="date" value={draft.endsOn} onChange={e => setDraft({ ...draft, endsOn: e.target.value })} /></div>
        <div className="field"><label htmlFor="t-note">Return note</label><input id="t-note" value={draft.returnNote} placeholder="Flight home Sun 6:40 PM" onChange={e => setDraft({ ...draft, returnNote: e.target.value })} /></div>
        <div className="row"><button className="primary">Add trip</button>{view}</div>
      </form>
    </section>
  );
}

function DisplayCard({ settings }: { settings: SettingsT }) {
  const [d, setD] = useState(settings);
  const { run, view } = useStatus();
  useEffect(() => setD(settings), [settings]);
  return (
    <form className="card grid-form" onSubmit={e => {
      e.preventDefault();
      void run(() => api('PUT', '/api/settings', { ...d, latitude: Number(d.latitude), longitude: Number(d.longitude), idleMinutes: Number(d.idleMinutes) }), 'Saved.');
    }}>
      <h2 className="span-all">Wall display</h2>
      <div className="field"><label htmlFor="s-dim1">Dim the screen from</label><input id="s-dim1" type="time" value={d.dimStart} onChange={e => setD({ ...d, dimStart: e.target.value })} /></div>
      <div className="field"><label htmlFor="s-dim2">until</label><input id="s-dim2" type="time" value={d.dimEnd} onChange={e => setD({ ...d, dimEnd: e.target.value })} /></div>
      <div className="field"><label htmlFor="s-idle">Show the clock after (minutes untouched)</label><input id="s-idle" type="number" min={1} value={d.idleMinutes} onChange={e => setD({ ...d, idleMinutes: Number(e.target.value) })} /></div>
      <div className="field"><label htmlFor="s-place">Weather for</label><input id="s-place" value={d.placeName} onChange={e => setD({ ...d, placeName: e.target.value })} /></div>
      <div className="field"><label htmlFor="s-lat">Latitude</label><input id="s-lat" inputMode="decimal" value={d.latitude} onChange={e => setD({ ...d, latitude: e.target.value as unknown as number })} /></div>
      <div className="field"><label htmlFor="s-lon">Longitude</label><input id="s-lon" inputMode="decimal" value={d.longitude} onChange={e => setD({ ...d, longitude: e.target.value as unknown as number })} /></div>
      <div className="row span-all"><button className="primary">Save display settings</button>{view}</div>
    </form>
  );
}

function SampleDataCard({ board }: { board: Board }) {
  const [confirm, setConfirm] = useState(false);
  const { run, view } = useStatus();
  return (
    <section className="card">
      <h2>Sample data</h2>
      {board.hasDemoData ? <>
        <p className="hint">The board is showing made-up events, activities and a trip so you can see how it works. Removing them keeps your family, colors, settings and the school calendar.</p>
        {!confirm
          ? <button className="danger" onClick={() => setConfirm(true)}>Remove sample data</button>
          : <div className="row wrap">
              <span>Remove all sample events, activities and trips?</span>
              <button className="danger" onClick={() => { setConfirm(false); void run(() => api('POST', '/api/demo/clear'), 'Sample data removed.'); }}>Yes, remove</button>
              <button onClick={() => setConfirm(false)}>Keep it</button>
            </div>}
      </> : <>
        <p className="hint">No sample data is loaded.</p>
        <button onClick={() => void run(() => api('POST', '/api/demo/load'), 'Sample data loaded.')}>Load sample data</button>
      </>}
      {view}
    </section>
  );
}

function AppearanceCard({ board }: { board: Board }) {
  const choice = useThemeChoice();
  const options: Array<[ThemeChoice, string]> = [
    ['auto', 'Match this device'], ['light', 'Light'], ['dark', 'Dark'], ['night', 'Dark at night'],
  ];
  return (
    <section className="card">
      <h2>Appearance</h2>
      <p className="hint">
        Applies to this screen only, so the wall and each phone can differ. “Dark at night” switches to dark from{' '}
        {formatTime(board.settings.dimStart)} to {formatTime(board.settings.dimEnd)}, the wall’s dimming hours.
      </p>
      <div className="segmented" role="radiogroup" aria-label="Appearance">
        {options.map(([value, label]) => (
          <button key={value} role="radio" aria-checked={choice === value} aria-pressed={choice === value}
            onClick={() => setThemeChoice(value)}>{label}</button>
        ))}
      </div>
    </section>
  );
}

export function SettingsPage({ board }: { board: Board }) {
  return (
    <div className="phone-page settings">
      <h1>Settings</h1>
      <h2 className="section-title">Family</h2>
      {board.people.map(p => <PersonCard key={p.id} person={p} />)}
      <CalendarsCard board={board} />
      <SchoolCard board={board} />
      <TripsCard board={board} />
      <AppearanceCard board={board} />
      <DisplayCard settings={board.settings} />
      <SampleDataCard board={board} />
    </div>
  );
}
