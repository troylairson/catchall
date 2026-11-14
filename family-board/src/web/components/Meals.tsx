import { useEffect, useState } from 'react';
import type { Board, Dinner, Meal } from '../../shared/types';
import { addDays, dateRange, dayOfMonth, monthName, startOfWeek, weekdayName } from '../../shared/dates';
import { api, useBoard } from '../api';
import { colorVar, personById } from '../lib';
import { Avatar } from './Avatar';

/** One day's dinner: type or pick a saved meal, and who's cooking. Saves as you go. */
function DinnerRow({ board, date, dinner }: { board: Board; date: string; dinner?: Dinner }) {
  const [title, setTitle] = useState(dinner?.title ?? '');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setTitle(dinner?.title ?? ''), [dinner?.title]);
  const cook = dinner?.cookId ? personById(board, dinner.cookId) : undefined;
  const meal = dinner?.mealId ? board.meals.find(m => m.id === dinner.mealId) : undefined;
  const id = `dinner-${date}`;

  const save = async (patch: { title?: string; cookId?: string | null }) => {
    setError(null);
    try {
      await api('PUT', `/api/dinners/${date}`, { title: patch.title ?? title, cookId: patch.cookId === undefined ? dinner?.cookId ?? null : patch.cookId, note: dinner?.note ?? '' });
    } catch (err) { setError((err as Error).message); }
  };

  return (
    <div className={`dinner-row${date === board.today ? ' today' : ''}${dinner ? '' : ' empty-day'}`} style={colorVar(cook)}>
      <label className="dinner-day" htmlFor={id}>
        <span className="dinner-dow">{date === board.today ? 'Tonight' : weekdayName(date, true)}</span>
        <span className="dinner-num">{monthName(date, true)} {dayOfMonth(date)}</span>
      </label>
      <div className="dinner-main">
        <input id={id} list="saved-meals" value={title} placeholder="What’s for dinner?" autoComplete="off"
          onChange={e => setTitle(e.target.value)}
          onBlur={() => { if (title.trim() !== (dinner?.title ?? '')) void save({ title }); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        {meal?.url && <a className="dinner-link" href={meal.url} target="_blank" rel="noopener noreferrer">Recipe</a>}
        {error && <p className="status error">{error}</p>}
      </div>
      <div className="dinner-cook">
        {cook && <Avatar person={cook} size="sm" />}
        <label className="sr-only" htmlFor={`${id}-cook`}>Who’s cooking</label>
        <select id={`${id}-cook`} value={dinner?.cookId ?? ''} disabled={!dinner}
          onChange={e => void save({ cookId: e.target.value || null })}>
          <option value="">Who’s cooking?</option>
          {board.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
    </div>
  );
}

function MealEditor({ meal, onClose }: { meal: Meal; onClose: () => void }) {
  const [draft, setDraft] = useState({ name: meal.name, url: meal.url, notes: meal.notes, ingredients: meal.ingredients.join('\n') });
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const id = `meal-${meal.id}`;
  return (
    <form className="meal-editor grid-form" onSubmit={async e => {
      e.preventDefault();
      try { await api('PUT', `/api/meals/${meal.id}`, draft); onClose(); } catch (err) { setError((err as Error).message); }
    }}>
      <div className="field"><label htmlFor={`${id}-name`}>Name</label><input id={`${id}-name`} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></div>
      <div className="field"><label htmlFor={`${id}-url`}>Recipe link (optional)</label><input id={`${id}-url`} type="url" value={draft.url} placeholder="https://…" onChange={e => setDraft({ ...draft, url: e.target.value })} /></div>
      <div className="field span-all"><label htmlFor={`${id}-ing`}>Ingredients, one per line</label>
        <textarea id={`${id}-ing`} rows={5} value={draft.ingredients} placeholder={'Tortillas\nGround beef\nCheese'} onChange={e => setDraft({ ...draft, ingredients: e.target.value })} /></div>
      <div className="field span-all"><label htmlFor={`${id}-notes`}>Notes</label><input id={`${id}-notes`} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></div>
      {error && <p className="status error span-all">{error}</p>}
      <div className="row wrap span-all">
        <button className="primary">Save</button>
        <button type="button" onClick={onClose}>Cancel</button>
        {!confirm
          ? <button type="button" className="link-btn danger-link" onClick={() => setConfirm(true)}>Delete meal</button>
          : <><span>Delete {meal.name}? Planned dinners keep their name.</span>
              <button type="button" className="danger" onClick={() => void api('DELETE', `/api/meals/${meal.id}`).then(onClose)}>Delete</button></>}
      </div>
    </form>
  );
}

function SavedMeals({ board }: { board: Board }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section className="saved-meals">
      <button className="link-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide' : 'Show'} saved meals ({board.meals.length})
      </button>
      {open && (
        <ul className="meal-list">
          {board.meals.length === 0 && <li className="muted">Meals you plan are saved here automatically.</li>}
          {board.meals.map(m => (
            <li key={m.id}>
              {editing === m.id
                ? <MealEditor meal={m} onClose={() => setEditing(null)} />
                : <button className="meal-item" onClick={() => setEditing(m.id)}>
                    <span className="meal-name">{m.name}</span>
                    <span className="muted small">{m.ingredients.length ? `${m.ingredients.length} ingredients` : 'No ingredients yet'}{m.url ? ' · recipe' : ''}</span>
                  </button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MealsView({ board }: { board: Board }) {
  const [offset, setOffset] = useState(0);
  const from = addDays(startOfWeek(board.today), offset * 7);
  const to = addDays(from, 6);
  const other = useBoard({ from, to });
  const shown = offset === 0 ? board : other.board && other.board.from === from ? other.board : null;
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  useEffect(() => setStatus(null), [offset]);

  const run = async (fn: () => Promise<string>) => {
    try { setStatus({ text: await fn() }); } catch (err) { setStatus({ text: (err as Error).message, error: true }); }
  };

  return (
    <div className="meals">
      <div className="week-nav">
        <button className="icon-btn" onClick={() => setOffset(o => o - 1)} aria-label="Previous week">‹</button>
        <div className="week-nav-label">
          <b>{offset === 0 ? 'This week' : offset === 1 ? 'Next week' : offset === -1 ? 'Last week' : `${monthName(from, true)} ${dayOfMonth(from)}`}</b>
          <span className="muted">Dinners</span>
        </div>
        <button className="icon-btn" onClick={() => setOffset(o => o + 1)} aria-label="Next week">›</button>
        {offset !== 0 && <button className="link-btn" onClick={() => setOffset(0)}>Back to this week</button>}
      </div>

      <datalist id="saved-meals">
        {board.meals.map(m => <option key={m.id} value={m.name} />)}
      </datalist>

      {!shown ? <p className="empty">{other.error ?? 'Loading…'}</p> : (
        <div className="dinner-list">
          {dateRange(from, to).map(d => (
            <DinnerRow key={d} board={shown} date={d} dinner={shown.dinners.find(x => x.date === d)} />
          ))}
        </div>
      )}

      <div className="row wrap meal-actions">
        <button onClick={() => run(async () => {
          const r = await api<{ copied: number }>('POST', '/api/dinners/copy-week', { from });
          return r.copied ? `Copied ${r.copied} ${r.copied === 1 ? 'dinner' : 'dinners'} from the week before.` : 'Nothing to copy: the week before has no dinners for this week’s empty days.';
        })}>Copy the week before</button>
        <button onClick={() => run(async () => {
          const r = await api<{ added: string[]; missing: string[] }>('POST', '/api/dinners/groceries', { from, to });
          const parts = [r.added.length ? `Added ${r.added.length} ${r.added.length === 1 ? 'item' : 'items'} to Groceries.` : 'Groceries already has everything.'];
          if (r.missing.length) {
            parts.push(r.missing.length <= 2
              ? `No ingredients saved yet for ${r.missing.join(' or ')}.`
              : `${r.missing.length} dinners have no ingredients saved yet. Add them under Saved meals.`);
          }
          return parts.join(' ');
        })}>Add this week’s ingredients to Groceries</button>
      </div>
      {status && <p className={`status${status.error ? ' error' : ''}`} role="status">{status.text}</p>}
      <SavedMeals board={board} />
    </div>
  );
}
