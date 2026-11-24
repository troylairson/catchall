import { useState } from 'react';
import type { Board, FamilyList, ListItem } from '../../shared/types';
import { dayOfMonth, shortDate, weekday } from '../../shared/dates';
import { buildRule, describeRule } from '../../shared/recurrence';
import { api } from '../api';
import { colorVar, personById } from '../lib';
import { Avatar } from './Avatar';
import { TodoCheck } from './TodoCheck';

function detailFor(board: Board, item: ListItem): string {
  const parts: string[] = [];
  if (item.rrule) parts.push(`↻ ${describeRule(item.rrule)}`);
  if (item.dueOn) {
    const due = item.dueOn === board.today ? 'Today' : shortDate(item.dueOn);
    parts.push(item.dueOn < board.today && !item.done ? `Overdue · ${shortDate(item.dueOn)}` : item.rrule ? due : `Due ${due}`);
  }
  return parts.join(' · ');
}

type Repeat = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Monday = 0 … Sunday = 6, as the rule presets expect. */
const presetDay = (date: string) => (weekday(date) + 6) % 7;

function ruleFor(repeat: Repeat, days: number[], date: string): string | null {
  if (repeat === 'daily') return 'FREQ=DAILY';
  if (repeat === 'monthly') return `FREQ=MONTHLY;BYMONTHDAY=${dayOfMonth(date)}`;
  if ((repeat === 'weekly' || repeat === 'biweekly') && days.length) {
    return buildRule({ kind: 'weekly', days, interval: repeat === 'biweekly' ? 2 : 1 });
  }
  return null;
}

function AddItem({ board, list }: { board: Board; list: FamilyList }) {
  const [text, setText] = useState('');
  const [personId, setPersonId] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [days, setDays] = useState<number[]>([presetDay(board.today)]);
  const [more, setMore] = useState(false);
  const rule = ruleFor(repeat, days, dueOn || board.today);
  const [error, setError] = useState<string | null>(null);
  const id = `add-${list.id}`;
  return (
    <form className="add-item" onSubmit={async e => {
      e.preventDefault();
      if (!text.trim()) return;
      setError(null);
      try {
        await api('POST', `/api/lists/${list.id}/items`, { text, personId: personId || null, dueOn: dueOn || null, rrule: rule });
        setText('');
        setDueOn('');
        setPersonId('');
        setRepeat('none');
      } catch (err) { setError((err as Error).message); }
    }}>
      <div className="row">
        <label className="sr-only" htmlFor={id}>Add to {list.name}</label>
        <input id={id} value={text} autoComplete="off" placeholder={list.kind === 'grocery' ? 'Add groceries…' : 'Add a to-do…'}
          onChange={e => setText(e.target.value)} />
        <button className="primary" disabled={!text.trim() || (repeat !== 'none' && !rule)}>Add</button>
      </div>
      {list.kind === 'todo' && (more
        ? <div className="row wrap add-more">
            <div className="field"><label htmlFor={`${id}-who`}>For</label>
              <select id={`${id}-who`} value={personId} onChange={e => setPersonId(e.target.value)}>
                <option value="">Anyone</option>
                {board.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
            <div className="field"><label htmlFor={`${id}-due`}>{repeat === 'none' ? 'Due' : 'Starting'}</label>
              <input id={`${id}-due`} type="date" value={dueOn} onChange={e => setDueOn(e.target.value)} /></div>
            <div className="field"><label htmlFor={`${id}-repeat`}>Repeats</label>
              <select id={`${id}-repeat`} value={repeat} onChange={e => setRepeat(e.target.value as Repeat)}>
                <option value="none">Doesn’t repeat</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="biweekly">Every other week</option>
                <option value="monthly">Every month</option>
              </select></div>
            {(repeat === 'weekly' || repeat === 'biweekly') && (
              <div className="day-picker span-all" role="group" aria-label="Days">
                {DAYS.map((d, i) => (
                  <button key={d} type="button" aria-pressed={days.includes(i)}
                    onClick={() => setDays(days.includes(i) ? days.filter(x => x !== i) : [...days, i])}>{d}</button>
                ))}
              </div>
            )}
            {rule && <p className="hint span-all">↻ {describeRule(rule)}. Checking it off adds the next one.</p>}
          </div>
        : <button type="button" className="link-btn" onClick={() => setMore(true)}>Add a person, due date or repeat</button>)}
      {error && <p className="status error">{error}</p>}
    </form>
  );
}

function ListCard({ board, list }: { board: Board; list: FamilyList }) {
  const items = board.items.filter(i => i.listId === list.id);
  const open = items.filter(i => !i.done);
  const done = items.filter(i => i.done);
  return (
    <section className="list-card" aria-label={list.name}>
      <header className="list-head">
        <h2>{list.icon} {list.name}</h2>
        <span className="muted">{open.length === 0 ? 'All done' : `${open.length} left`}</span>
      </header>
      <div className="list-items">
        {open.length === 0 && done.length === 0 && (
          <p className="empty">{list.kind === 'grocery' ? 'Nothing to buy. Add items below, or from Meals.' : 'Nothing to do. Add something below.'}</p>
        )}
        {[...open, ...done].map(i => {
          const person = i.personId ? personById(board, i.personId) : undefined;
          return (
            <div key={i.id} className="list-row" style={colorVar(person)}>
              <TodoCheck itemId={i.id} done={i.done} title={i.text} detail={detailFor(board, i)} />
              {person && <Avatar person={person} size="sm" />}
              <button className="icon-btn small" aria-label={`Remove ${i.text}`} onClick={() => void api('DELETE', `/api/items/${i.id}`)}>×</button>
            </div>
          );
        })}
      </div>
      {done.length > 0 && (
        <button className="link-btn" onClick={() => void api('POST', `/api/lists/${list.id}/clear-done`)}>
          Clear {done.length} checked {done.length === 1 ? 'item' : 'items'}
        </button>
      )}
      <AddItem board={board} list={list} />
    </section>
  );
}

export function ListsView({ board }: { board: Board }) {
  return (
    <div className="lists" style={{ '--n': board.lists.length } as React.CSSProperties}>
      {board.lists.map(l => <ListCard key={l.id} board={board} list={l} />)}
    </div>
  );
}
