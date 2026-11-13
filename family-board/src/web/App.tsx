import { useEffect, useState } from 'react';
import { useBoard } from './api';
import { Wall } from './components/Wall';
import { PhoneAgenda } from './components/Phone';
import { KidsView } from './components/KidsView';
import { SettingsPage } from './components/Settings';
import { ActivityEditor, ActivityList } from './components/Activities';

function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => { setHash(window.location.hash); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#\/?/, '');
}

function useIsWide(): boolean {
  const query = '(min-width: 900px) and (min-height: 560px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

const TABS = [
  ['', 'Today'], ['kids', 'Kids'], ['activities', 'Activities'], ['settings', 'Settings'],
] as const;

export function App() {
  const route = useHash();
  const wide = useIsWide();
  const { board, error, loadedAt } = useBoard();

  if (!board) {
    return (
      <div className="loading">
        {error ? <><h1>Can’t reach the Family Board server</h1><p>{error}</p><p>It will keep trying.</p></> : <p>Loading…</p>}
      </div>
    );
  }

  // The wall layout: on wide screens at the home route, or anywhere at #/wall.
  if (route === 'wall' || (route === '' && wide)) {
    return <Wall board={board} stale={!!error} loadedAt={loadedAt} />;
  }

  const [section, sub] = route.split('/');
  let page: React.ReactNode;
  if (section === 'kids') page = <div className="phone-page"><h1>Kids</h1><KidsView board={board} /></div>;
  else if (section === 'activities' && sub) page = <ActivityEditor key={sub} board={board} id={sub === 'new' ? null : sub} />;
  else if (section === 'activities') page = <ActivityList board={board} />;
  else if (section === 'settings') page = <SettingsPage board={board} />;
  else page = <PhoneAgenda today={board.today} />;

  return (
    <div className="phone">
      {error && <div className="notice warn">Can’t reach the server. Changes won’t save until it’s back.</div>}
      <main>{page}</main>
      <nav className="tabbar" aria-label="Sections">
        {TABS.map(([path, label]) => (
          <a key={label} href={`#/${path}`} aria-current={(section || '') === path ? 'page' : undefined}>{label}</a>
        ))}
        {wide && <a href="#/wall">Wall</a>}
      </nav>
    </div>
  );
}
