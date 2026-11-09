import { LESSONS } from '../lessons/lessons';
import { isUnlocked, nextLessonId } from '../lessons/path';
import { progress } from '../state/progress';

export function LessonPath() {
  const p = progress.use();
  const next = nextLessonId(p.lessons);
  const doneCount = LESSONS.filter((l) => p.lessons[l.id]?.done).length;
  const hasSong = (id: number) => LESSONS.find((l) => l.id === id)!.steps.some((s) => s.kind === 'rhythm' && s.song);

  return (
    <div className="page">
      <h1>{doneCount === 0 ? 'Welcome! Let’s get you playing.' : doneCount === LESSONS.length ? 'You finished the starter path! 🎉' : 'Welcome back.'}</h1>
      {doneCount === 0 && (
        <div className="card">
          <p className="big" style={{ marginTop: 0 }}>
            No music reading. No theory. Short lessons, one skill each — and you’ll play a real song in lesson 3.
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            If you’ve tried before and got stuck: that’s usually because full chords come too early. Here you start with easy versions that take one finger
            (or none), and the app adds smaller steps whenever something is tricky.
          </p>
        </div>
      )}
      <div className="path">
        {LESSONS.map((l) => {
          const lp = p.lessons[l.id];
          const done = !!lp?.done;
          const open = isUnlocked(l.id, p.lessons);
          const added = lp ? Object.values(lp.inserted).reduce((a, b) => a + b, 0) : 0;
          return (
            <a key={l.id} href={`#/lesson/${l.id}`} className={`lesson-card ${done ? 'done' : ''} ${l.id === next && !done ? 'next' : ''} ${open ? '' : 'locked'}`}>
              <div className="lesson-num">{done ? '✓' : l.id}</div>
              <div style={{ flex: 1 }}>
                <h3>{l.title}</h3>
                <p>{l.skill}</p>
              </div>
              {added > 0 && <span className="tag">+{added} smaller step{added > 1 ? 's' : ''}</span>}
              {hasSong(l.id) && <span className="tag song">♪ song</span>}
              <span className="muted small">{l.minutes}</span>
            </a>
          );
        })}
      </div>
      <div className="row gap wrap">
        <span className="muted small">Practice tools any time:</span>
        <a href="#/tuner">Tuner</a>
        <a href="#/rhythm">Strum game</a>
        <a href="#/switch">Chord switch drill</a>
        <a href="#/setup">Setup check</a>
        <span className="spacer" />
        <button
          className="link small"
          onClick={() => {
            if (confirm('Start the lessons over from the beginning? Your settings are kept.')) progress.reset();
          }}
        >
          Reset lesson progress
        </button>
      </div>
    </div>
  );
}
