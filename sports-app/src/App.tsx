import { useEffect, useState } from 'react';
import { teamByKey } from './teams';
import { useFavorites } from './useFavorites';
import { useScores } from './useScores';
import { sortTeams } from './snapshot';
import { easternDay } from './time';
import { TeamCard } from './components/TeamCard';
import { GameView } from './views/GameView';
import { SettingsSheet } from './views/Settings';
import { TeamsEditor } from './views/TeamsEditor';
import { syncPush } from './push';

function useHashRoute() {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

const updatedFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });

export function App() {
  const route = useHashRoute();
  const fav = useFavorites();
  const scores = useScores(fav.teams);
  // Keep the server's list of teams to alert about in step with favorites.
  const favKey = fav.keys.join(',');
  useEffect(() => {
    syncPush().catch(() => {});
  }, [favKey]);
  const [settings, setSettings] = useState(false);

  if (route[0] === 'game' && route[1] && route[2]) {
    const team = teamByKey(route[1]);
    if (team) {
      const game = scores.games(team.key).find((g) => g.id === route[2]);
      return <GameView team={team} gameId={route[2]} summary={game} />;
    }
  }

  if (route[0] === 'teams') return <TeamsEditor onDone={() => (location.hash = '')} />;

  const today = easternDay(Date.now());
  const items = sortTeams(
    fav.teams.map((team) => ({ team, snap: scores.snapshots[team.key] })),
    (iso) => easternDay(iso) === today,
  );

  return (
    <div className="app">
      <header className="topbar">
        <h1>Scores</h1>
        <div className="topbar-actions">
          <span className="muted small" aria-live="polite">
            {!navigator.onLine
              ? 'Offline · last known scores'
              : scores.loading
                ? 'Updating…'
                : scores.updatedAt
                  ? `Updated ${updatedFmt.format(scores.updatedAt)}`
                  : ''}
          </span>
          <button className="icon-btn" onClick={() => scores.refresh(true)} aria-label="Refresh" disabled={scores.loading}>
            <svg viewBox="0 0 24 24" width="20" height="20" className={scores.loading ? 'spin' : ''}>
              <path fill="currentColor" d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z" />
            </svg>
          </button>
          <button className="icon-btn" onClick={() => setSettings(true)} aria-label="Settings">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L4.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5L19.4 13ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" />
            </svg>
          </button>
        </div>
      </header>
      <main className="cards">
        {items.map(({ team, snap }) => (
          <TeamCard
            key={team.key}
            team={team}
            snap={snap}
            error={scores.errors[team.key]}
            onOpen={(id) => (location.hash = `#/game/${team.key}/${id}`)}
          />
        ))}
        {fav.teams.length === 0 && (
          <div className="card empty">
            <p>Pick the teams you follow.</p>
          </div>
        )}
      </main>
      <button className="btn wide" onClick={() => (location.hash = '#/teams')}>
        {fav.teams.length ? 'Edit teams' : 'Add teams'}
      </button>
      <footer className="foot muted small">All times Eastern · Data: ESPN, NHL, MLB</footer>
      {settings && (
        <SettingsSheet
          onClose={(changed) => {
            setSettings(false);
            if (changed) scores.refresh(true);
          }}
        />
      )}
    </div>
  );
}
