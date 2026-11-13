import { useEffect, useState } from 'react';
import type { Activity, Board, Occurrence } from '../../shared/types';
import { buildRule, describeActivity, describeRule, parsePreset, type RulePreset } from '../../shared/recurrence';
import { addDays, formatTime, shortDate } from '../../shared/dates';
import { api } from '../api';
import { colorVar } from '../lib';
import { Avatar } from './Avatar';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const NTHS: Array<[number, string]> = [[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [-1, 'Last']];

export function ActivityList({ board }: { board: Board }) {
  return (
    <div className="phone-page">
      <div className="row between">
        <h1>Activities</h1>
        <a className="button primary" href="#/activities/new">Add activity</a>
      </div>
      <p className="hint">Practices, clubs and lessons that repeat. The Kids view on the wall uses these to answer “is today a … day?”.</p>
      {board.people.map(p => {
        const acts = board.activities.filter(a => a.personId === p.id);
        if (!acts.length && p.role !== 'kid') return null;
        return (
          <section key={p.id} className="card" style={colorVar(p)}>
            <h2 className="row"><Avatar person={p} size="sm" />{p.name}</h2>
            {acts.length === 0 && <p className="muted">No activities yet.</p>}
            <ul className="act-list">
              {acts.map(a => (
                <li key={a.id}>
                  <a href={`#/activities/${a.id}`}>
                    <span className="act-list-name">{a.icon} {a.name}{a.demo && <span className="tag">Sample</span>}</span>
                    <span className="muted">{describeActivity(a)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

interface Draft extends Omit<Activity, 'id' | 'rrule'> {
  preset: RulePreset | null;
  /** The original rule, kept when it doesn't match a preset and isn't changed. */
  rawRule: string;
}

function toDraft(a: Activity | undefined, board: Board): Draft {
  const kid = board.people.find(p => p.role === 'kid') ?? board.people[0];
  if (!a) {
    return {
      personId: kid?.id ?? '', name: '', icon: '', startTime: '15:15', endTime: '16:30', location: '', notes: '',
      skipOn: ['no_school'], startsOn: board.today, endsOn: board.schoolYear?.lastStudentDay ?? null,
      preset: { kind: 'weekly', days: [], interval: 1 }, rawRule: '',
    };
  }
  return { ...a, preset: parsePreset(a.rrule), rawRule: a.rrule };
}

export function ActivityEditor({ board, id }: { board: Board; id: string | null }) {
  const existing = id ? board.activities.find(a => a.id === id) : undefined;
  const [d, setD] = useState<Draft>(() => toDraft(existing, board));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (id && !existing) {
    return <div className="phone-page"><p className="empty">That activity no longer exists.</p><a href="#/activities">Back to activities</a></div>;
  }

  const p = d.preset;
  const rule = p ? (p.kind === 'weekly' ? (p.days.length ? buildRule(p) : '') : (p.nths.length ? buildRule(p) : '')) : d.rawRule;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rule) { setError('Choose which days it happens.'); return; }
    const body = { ...d, rrule: rule, endsOn: d.endsOn || null };
    try {
      if (existing) await api('PUT', `/api/activities/${existing.id}`, body);
      else await api('POST', '/api/activities', body);
      window.location.hash = '#/activities';
    } catch (err) { setError((err as Error).message); }
  };

  const remove = async () => {
    try { await api('DELETE', `/api/activities/${existing!.id}`); window.location.hash = '#/activities'; }
    catch (err) { setError((err as Error).message); }
  };

  const toggleDay = (i: number) => {
    if (p?.kind !== 'weekly') return;
    setD({ ...d, preset: { ...p, days: p.days.includes(i) ? p.days.filter(x => x !== i) : [...p.days, i] } });
  };
  const toggleNth = (n: number) => {
    if (p?.kind !== 'monthly') return;
    setD({ ...d, preset: { ...p, nths: p.nths.includes(n) ? p.nths.filter(x => x !== n) : [...p.nths, n] } });
  };

  return (
    <div className="phone-page">
      <a className="link-btn" href="#/activities">‹ Activities</a>
      <h1>{existing ? `Edit ${existing.name}` : 'Add activity'}</h1>
      <form className="card grid-form" onSubmit={save}>
        <div className="field"><label htmlFor="a-who">Who</label>
          <select id="a-who" value={d.personId} onChange={e => setD({ ...d, personId: e.target.value })}>
            {board.people.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></div>
        <div className="field"><label htmlFor="a-name">Name</label><input id="a-name" value={d.name} placeholder="Chess club" onChange={e => setD({ ...d, name: e.target.value })} /></div>
        <div className="field narrow"><label htmlFor="a-icon">Emoji</label><input id="a-icon" value={d.icon} placeholder="♟️" onChange={e => setD({ ...d, icon: e.target.value })} /></div>

        <fieldset className="field span-all">
          <legend>How often</legend>
          <div className="segmented">
            <button type="button" aria-pressed={p?.kind === 'weekly' && p.interval === 1} onClick={() => setD({ ...d, preset: { kind: 'weekly', days: p?.kind === 'weekly' ? p.days : [], interval: 1 } })}>Every week</button>
            <button type="button" aria-pressed={p?.kind === 'weekly' && p.interval === 2} onClick={() => setD({ ...d, preset: { kind: 'weekly', days: p?.kind === 'weekly' ? p.days : [], interval: 2 } })}>Every other week</button>
            <button type="button" aria-pressed={p?.kind === 'monthly'} onClick={() => setD({ ...d, preset: { kind: 'monthly', nths: p?.kind === 'monthly' ? p.nths : [], day: p?.kind === 'monthly' ? p.day : 3 } })}>Certain weeks of the month</button>
          </div>
          {p?.kind === 'weekly' && (
            <div className="day-picker" role="group" aria-label="Days">
              {DAYS.map((name, i) => <button type="button" key={name} aria-pressed={p.days.includes(i)} onClick={() => toggleDay(i)}>{name}</button>)}
            </div>
          )}
          {p?.kind === 'monthly' && (
            <div className="row wrap">
              <div className="day-picker" role="group" aria-label="Which weeks">
                {NTHS.map(([n, label]) => <button type="button" key={n} aria-pressed={p.nths.includes(n)} onClick={() => toggleNth(n)}>{label}</button>)}
              </div>
              <select aria-label="Day of the week" value={p.day} onChange={e => setD({ ...d, preset: { ...p, day: Number(e.target.value) } })}>
                {DAY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
              </select>
            </div>
          )}
          {!p && <p className="hint">Custom rule: {describeRule(d.rawRule)}. Choose an option above to replace it.</p>}
          {rule && <p className="hint">{describeRule(rule)}</p>}
        </fieldset>

        <div className="field"><label htmlFor="a-start">Starts at</label><input id="a-start" type="time" value={d.startTime} onChange={e => setD({ ...d, startTime: e.target.value })} /></div>
        <div className="field"><label htmlFor="a-end">Ends at</label><input id="a-end" type="time" value={d.endTime} onChange={e => setD({ ...d, endTime: e.target.value })} /></div>
        <div className="field"><label htmlFor="a-loc">Where</label><input id="a-loc" value={d.location} placeholder="Room 204" onChange={e => setD({ ...d, location: e.target.value })} /></div>
        <div className="field"><label htmlFor="a-from">First date</label><input id="a-from" type="date" value={d.startsOn} onChange={e => setD({ ...d, startsOn: e.target.value })} /></div>
        <div className="field"><label htmlFor="a-until">Last date (optional)</label><input id="a-until" type="date" value={d.endsOn ?? ''} onChange={e => setD({ ...d, endsOn: e.target.value || null })} /></div>
        <label className="check span-all">
          <input type="checkbox" checked={d.skipOn.includes('no_school')}
            onChange={e => setD({ ...d, skipOn: e.target.checked ? ['no_school'] : [] })} />
          Doesn’t happen on days with no school (breaks, holidays, snow days, summer)
        </label>
        <div className="field span-all"><label htmlFor="a-notes">Notes</label><input id="a-notes" value={d.notes} onChange={e => setD({ ...d, notes: e.target.value })} /></div>
        {error && <p className="status error span-all" role="alert">{error}</p>}
        <div className="row span-all"><button className="primary">{existing ? 'Save changes' : 'Add activity'}</button><a href="#/activities">Cancel</a></div>
      </form>

      {existing && <OneOffChanges board={board} activity={existing} />}

      {existing && (
        <section className="card">
          {!confirmDelete
            ? <button className="danger" onClick={() => setConfirmDelete(true)}>Delete {existing.name}</button>
            : <div className="row wrap">
                <span>Delete {existing.name} and all its one-time changes?</span>
                <button className="danger" onClick={() => void remove()}>Yes, delete</button>
                <button onClick={() => setConfirmDelete(false)}>Keep it</button>
              </div>}
        </section>
      )}
    </div>
  );
}

type Mode = { date: string; kind: 'cancel' | 'move' | 'note' } | null;

/** Upcoming dates for one activity, with cancel, move and note actions for each. */
function OneOffChanges({ board, activity }: { board: Board; activity: Activity }) {
  const [occ, setOcc] = useState<Occurrence[]>([]);
  const [mode, setMode] = useState<Mode>(null);
  const [form, setForm] = useState({ newDate: '', newStartTime: '', newEndTime: '', note: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<Board>('GET', `/api/board?from=${board.today}&to=${addDays(board.today, 56)}`)
      .then(b => setOcc(b.occurrences.filter(o => o.activityId === activity.id)));
  }, [board, activity.id]);

  const exceptions = board.exceptions.filter(e => e.activityId === activity.id);
  const open = (date: string, kind: 'cancel' | 'move' | 'note') => {
    setMode({ date, kind });
    setError(null);
    setForm({ newDate: kind === 'move' ? date : '', newStartTime: activity.startTime, newEndTime: activity.endTime, note: '' });
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mode) return;
    const body = mode.kind === 'move'
      ? { activityId: activity.id, date: mode.date, kind: 'move', newDate: form.newDate !== mode.date ? form.newDate : null, newStartTime: form.newStartTime, newEndTime: form.newEndTime, note: form.note || null }
      : { activityId: activity.id, date: mode.date, kind: mode.kind, note: form.note || null };
    try { await api('POST', '/api/exceptions', body); setMode(null); }
    catch (err) { setError((err as Error).message); }
  };

  return (
    <section className="card">
      <h2>Next eight weeks</h2>
      <p className="hint">Cancel, move or add a note to a single date. The regular schedule stays the same.</p>
      <ul className="occ-list">
        {occ.slice(0, 16).map(o => {
          const ex = exceptions.find(e => e.date === (o.movedFrom ?? o.date));
          return (
            <li key={`${o.date}-${o.status}`}>
              <div className="occ-row">
                <span className={`occ-date${o.status !== 'on' ? ' off' : ''}`}>
                  {shortDate(o.date)} · {formatTime(o.startTime)}
                </span>
                <span className="muted occ-why">{o.status !== 'on' ? o.reason : o.note ?? ''}</span>
                <span className="occ-actions">
                  {ex ? (
                    <button className="link-btn" onClick={() => void api('DELETE', `/api/exceptions/${ex.id}`)}>Undo change</button>
                  ) : o.status === 'on' ? <>
                    <button className="link-btn" onClick={() => open(o.date, 'cancel')}>Cancel</button>
                    <button className="link-btn" onClick={() => open(o.date, 'move')}>Move</button>
                    <button className="link-btn" onClick={() => open(o.date, 'note')}>Note</button>
                  </> : null}
                </span>
              </div>
              {mode?.date === o.date && o.status === 'on' && (
                <form className="occ-form" onSubmit={submit}>
                  {mode.kind === 'move' && <>
                    <div className="field"><label htmlFor="x-date">New date</label><input id="x-date" type="date" value={form.newDate} onChange={e => setForm({ ...form, newDate: e.target.value })} /></div>
                    <div className="field"><label htmlFor="x-start">Starts</label><input id="x-start" type="time" value={form.newStartTime} onChange={e => setForm({ ...form, newStartTime: e.target.value })} /></div>
                    <div className="field"><label htmlFor="x-end">Ends</label><input id="x-end" type="time" value={form.newEndTime} onChange={e => setForm({ ...form, newEndTime: e.target.value })} /></div>
                  </>}
                  <div className="field grow">
                    <label htmlFor="x-note">{mode.kind === 'cancel' ? 'Reason (optional)' : mode.kind === 'note' ? 'Note' : 'Note (optional)'}</label>
                    <input id="x-note" value={form.note} placeholder={mode.kind === 'note' ? 'Wear white jersey' : mode.kind === 'cancel' ? 'Coach out sick' : ''} onChange={e => setForm({ ...form, note: e.target.value })} />
                  </div>
                  {error && <p className="status error" role="alert">{error}</p>}
                  <div className="row">
                    <button className="primary">{mode.kind === 'cancel' ? `Cancel ${shortDate(o.date)}` : mode.kind === 'move' ? 'Move it' : 'Add note'}</button>
                    <button type="button" onClick={() => setMode(null)}>Never mind</button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
        {occ.length === 0 && <li className="muted">No dates in the next eight weeks.</li>}
      </ul>
    </section>
  );
}
