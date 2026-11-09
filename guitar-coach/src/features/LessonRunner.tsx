import { useState } from 'react';
import { Fretboard } from '../components/Fretboard';
import { Hand } from '../components/Hand';
import { LESSONS, Step } from '../lessons/lessons';
import { currentIndex, isUnlocked, recordResult, visibleSteps } from '../lessons/path';
import { CHORDS } from '../music/chords';
import { lessonProgress, progress, saveLessonProgress } from '../state/progress';
import { ShapeActivity } from './ChordShapeCheck';
import { RhythmActivity } from './RhythmGame';
import { SetupCheck } from './SetupCheck';
import { SwitchActivity } from './SwitchDrill';
import { Tuner } from './Tuner';

export function LessonRunner({ id }: { id: number }) {
  const lesson = LESSONS.find((l) => l.id === id);
  const all = progress.use().lessons;
  const p = lessonProgress(id);
  const steps = lesson ? visibleSteps(lesson, p) : [];
  const cur = lesson ? currentIndex(lesson, p) : 0;
  const [viewId, setViewId] = useState<string | null>(() => steps[cur]?.step.id ?? null);
  const [notice, setNotice] = useState<{ text: string; goto?: string } | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [tuned, setTuned] = useState(false);

  if (!lesson) return <p>Lesson not found.</p>;
  if (!isUnlocked(id, all))
    return (
      <div className="card center">
        <p className="big">Finish lesson {id - 1} first — each lesson builds on the one before.</p>
        <a className="btn primary" href={`#/lesson/${id - 1}`}>
          Go to lesson {id - 1}
        </a>
      </div>
    );

  const viewIdx = Math.max(0, steps.findIndex((s) => s.step.id === viewId));
  const view = celebrate || viewId === null ? null : steps[viewIdx];

  const record = (stepId: string, passed: boolean) => {
    const out = recordResult(lesson, lessonProgress(id), stepId, passed);
    saveLessonProgress(id, out.progress);
    if (passed) setNotice(null);
    else if (out.added)
      setNotice({
        text: `This one trips up almost everyone at first. I’ve added a smaller step to build up to it: “${out.added.title}”.`,
        goto: out.added.id,
      });
    else setNotice({ text: 'Have another go — every try counts as practice.' });
  };

  const goNext = () => {
    setNotice(null);
    const lp = lessonProgress(id);
    if (lp.done && lesson.steps.every((s) => lp.passed.includes(s.id)) && currentIndex(lesson, lp) >= visibleSteps(lesson, lp).length) {
      setCelebrate(true);
      return;
    }
    const vs = visibleSteps(lesson, lp);
    setViewId(vs[currentIndex(lesson, lp)]?.step.id ?? null);
  };

  const pass = (stepId: string) => {
    record(stepId, true);
    goNext();
  };

  const continueBtn = (
    <button className="btn primary" onClick={goNext}>
      Continue →
    </button>
  );

  return (
    <div className="page">
      <div>
        <a href="#/" className="muted small">
          ← All lessons
        </a>
        <h1>
          Lesson {lesson.id}: {lesson.title}
        </h1>
        <p className="lead">
          Today’s one skill: {lesson.skill.toLowerCase()} · {lesson.minutes}
        </p>
      </div>
      <div className="lesson-layout">
        <ol className="steps">
          {steps.map((s, i) => {
            const passed = p.passed.includes(s.step.id);
            const reachable = passed || i <= cur;
            return (
              <li
                key={s.step.id}
                className={`${view?.step.id === s.step.id ? 'on' : ''} ${passed ? 'passed' : ''} ${s.added ? 'added' : ''}`}
                onClick={() => reachable && (setCelebrate(false), setNotice(null), setViewId(s.step.id))}
                style={{ cursor: reachable ? 'pointer' : 'default' }}
              >
                <span>{passed ? '✓' : i === cur ? '▸' : '○'}</span>
                <span>
                  {s.step.title}
                  {s.added && <em className="small"> (smaller step)</em>}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="page">
          {notice && (
            <div className="banner info">
              {notice.text}{' '}
              {notice.goto && (
                <button
                  className="btn small"
                  onClick={() => {
                    setViewId(notice.goto!);
                    setNotice(null);
                  }}
                >
                  Try the smaller step
                </button>
              )}
            </div>
          )}

          {celebrate && (
            <div className="card celebrate">
              <div className="emoji">{lesson.steps.some((s) => s.kind === 'rhythm' && s.song) ? '🎉🎸🎶' : '🎉'}</div>
              <h2>Lesson {lesson.id} done!</h2>
              <p className="big">{lesson.win}</p>
              {lesson.id < LESSONS.length ? (
                <a className="btn primary" href={`#/lesson/${lesson.id + 1}`}>
                  Next: {LESSONS[lesson.id].title} →
                </a>
              ) : (
                <a className="btn primary" href="#/">
                  Back to the start
                </a>
              )}
              <p className="muted small">Tired? Stopping here is fine — your progress is saved.</p>
            </div>
          )}

          {view && <StepView key={view.step.id} step={view.step} record={record} pass={pass} continueBtn={continueBtn} tuned={tuned} setTuned={setTuned} retry={(p.fails[view.step.id] ?? 0) > 0} />}
        </div>
      </div>
    </div>
  );
}

function StepView({
  step,
  record,
  pass,
  continueBtn,
  tuned,
  setTuned,
  retry,
}: {
  step: Step;
  record: (id: string, passed: boolean) => void;
  pass: (id: string) => void;
  continueBtn: React.ReactNode;
  tuned: boolean;
  setTuned: (b: boolean) => void;
  retry: boolean;
}) {
  switch (step.kind) {
    case 'talk':
      return (
        <div className="card talk">
          <h2>{step.title}</h2>
          <div className={step.chord || step.hands ? 'two-col' : ''}>
            <div>
              {step.body.map((b, i) => (
                <p key={i}>{b}</p>
              ))}
            </div>
            <div>
              {step.chord && <Fretboard chord={CHORDS[step.chord]} spaces={3} />}
              {step.hands && <Hand />}
            </div>
          </div>
          <button className="btn primary" onClick={() => pass(step.id)}>
            Got it →
          </button>
        </div>
      );
    case 'setup':
      return <SetupCheck onDone={() => pass(step.id)} />;
    case 'tuner':
      return (
        <div className="page">
          <Tuner onDone={() => setTuned(true)} />
          <div className="row gap">
            <button className="btn ghost" onClick={() => pass(step.id)}>
              My guitar is already tuned — skip
            </button>
            <span className="spacer" />
            <button className="btn primary" disabled={!tuned} onClick={() => pass(step.id)}>
              All tuned — continue →
            </button>
          </div>
        </div>
      );
    case 'rhythm':
      return (
        <RhythmActivity
          cfg={step.cfg}
          pass={step.pass}
          song={step.song}
          experienced={retry}
          onResult={(r) => record(step.id, r.passed)}
          resultFooter={(r) => (r.passed ? continueBtn : <span className="muted">Goal: {Math.round(step.pass * 100)}% in time</span>)}
        />
      );
    case 'shape':
      return (
        <div className="page">
          <h2 style={{ margin: 0 }}>{step.title}</h2>
          <ShapeActivity chord={step.chord} onlyStrings={step.onlyStrings} onResult={(ok) => record(step.id, ok)} doneFooter={continueBtn} />
        </div>
      );
    case 'switch':
      return <SwitchActivity cfg={step.cfg} onResult={(r) => record(step.id, r.passed)} resultFooter={(r) => (r.passed ? continueBtn : null)} />;
  }
}
