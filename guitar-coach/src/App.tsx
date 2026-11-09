import { useEffect, useState } from 'react';
import { DebugPanel } from './components/DebugPanel';
import { Tuner } from './features/Tuner';
import { SetupCheck } from './features/SetupCheck';
import { RhythmPractice } from './features/RhythmGame';
import { SwitchPractice } from './features/SwitchDrill';
import { LessonPath } from './features/LessonPath';
import { LessonRunner } from './features/LessonRunner';
import { settings } from './state/settings';

function useHash() {
  const [h, set] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const f = () => {
      set(location.hash.slice(1) || '/');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h;
}

export function App() {
  const route = useHash();
  const s = settings.use();
  const parts = route.split('/').filter(Boolean);

  let page;
  if (parts[0] === 'lesson' && parts[1]) page = <LessonRunner key={parts[1]} id={Number(parts[1])} />;
  else if (parts[0] === 'tuner')
    page = (
      <Page title="Tuner">
        <Tuner />
      </Page>
    );
  else if (parts[0] === 'setup')
    page = (
      <Page title="Setup check">
        <SetupCheck />
      </Page>
    );
  else if (parts[0] === 'rhythm') page = <RhythmPractice />;
  else if (parts[0] === 'switch') page = <SwitchPractice />;
  else page = <LessonPath />;

  const nav = [
    ['/', 'Lessons'],
    ['/tuner', 'Tuner'],
    ['/rhythm', 'Strum game'],
    ['/switch', 'Chord switch'],
    ['/setup', 'Setup'],
  ];

  return (
    <div className={`app ${s.debugOpen ? 'with-debug' : ''}`}>
      <header className="topbar">
        <a href="#/" className="brand">
          🎸 First Chords
        </a>
        <nav>
          {nav.map(([href, label]) => (
            <a key={href} href={`#${href}`} className={(href === '/' ? route === '/' || parts[0] === 'lesson' : route.startsWith(href)) ? 'on' : ''}>
              {label}
            </a>
          ))}
        </nav>
        <label className="lefty" title="Flip the pictures for left-handed players">
          <input type="checkbox" checked={s.leftHanded} onChange={(e) => settings.set({ leftHanded: e.target.checked })} /> Left-handed
        </label>
      </header>
      <main>{page}</main>
      <DebugPanel />
    </div>
  );
}

export function Page({ title, children, sub }: { title: string; children: React.ReactNode; sub?: string }) {
  return (
    <div className="page">
      <h1>{title}</h1>
      {sub && <p className="lead">{sub}</p>}
      {children}
    </div>
  );
}
