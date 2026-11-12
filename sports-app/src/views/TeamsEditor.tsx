import { useState } from 'react';
import { CATALOG, LEAGUES } from '../teams';
import type { League } from '../types';
import { useFavorites } from '../useFavorites';
import { Logo } from '../components/Logo';

export function TeamsEditor({ onDone }: { onDone: () => void }) {
  const fav = useFavorites();
  const [league, setLeague] = useState<League>('nfl');
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const results = CATALOG.filter((t) =>
    needle ? `${t.name} ${t.abbr}`.toLowerCase().includes(needle) : t.league === league,
  );

  return (
    <div className="app">
      <header className="topbar">
        <h1>My teams</h1>
        <button className="btn" onClick={onDone}>
          Done
        </button>
      </header>

      {fav.teams.length === 0 ? (
        <div className="card muted">No teams yet. Add some below.</div>
      ) : (
        <ol className="feed card flush">
          {fav.teams.map((t, i) => (
            <li key={t.key} className="pick">
              <Logo src={t.logo} dark={t.logoDark} alt={t.abbr} size={32} />
              <span className="pick-name">
                {t.name}
                <span className="muted small"> · {t.league.toUpperCase()}</span>
              </span>
              <button className="icon-btn" aria-label={`Move ${t.short} up`} disabled={i === 0} onClick={() => fav.move(t.key, -1)}>
                ↑
              </button>
              <button
                className="icon-btn"
                aria-label={`Move ${t.short} down`}
                disabled={i === fav.teams.length - 1}
                onClick={() => fav.move(t.key, 1)}
              >
                ↓
              </button>
              <button className="icon-btn danger" aria-label={`Remove ${t.short}`} onClick={() => fav.remove(t.key)}>
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small hint">Live games always jump to the top. Otherwise cards follow this order.</p>

      <h3 className="feed-title">Add a team</h3>
      <input
        className="search"
        type="search"
        placeholder="Search all teams"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoCorrect="off"
      />
      {!needle && (
        <div className="chips" role="tablist">
          {LEAGUES.map((l) => (
            <button key={l.id} className={`chip ${league === l.id ? 'on' : ''}`} onClick={() => setLeague(l.id)}>
              {l.name}
            </button>
          ))}
        </div>
      )}
      <ol className="feed card flush">
        {results.map((t) => {
          const added = fav.keys.includes(t.key);
          return (
            <li key={t.key} className="pick">
              <Logo src={t.logo} dark={t.logoDark} alt={t.abbr} size={32} />
              <span className="pick-name">
                {t.name}
                {needle && <span className="muted small"> · {t.league.toUpperCase()}</span>}
              </span>
              <button
                className={`btn small-btn ${added ? 'ghost' : ''}`}
                onClick={() => (added ? fav.remove(t.key) : fav.add(t.key))}
                aria-label={added ? `Remove ${t.name}` : `Add ${t.name}`}
              >
                {added ? 'Added ✓' : 'Add'}
              </button>
            </li>
          );
        })}
        {results.length === 0 && <li className="pick muted">No teams match “{q}”.</li>}
      </ol>
    </div>
  );
}
