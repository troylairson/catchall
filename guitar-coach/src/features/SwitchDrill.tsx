import { ReactNode, useEffect, useRef, useState } from 'react';
import { engine } from '../audio/engine';
import { classifyChord, diagnoseChord, heardChord } from '../audio/chroma';
import { Fretboard } from '../components/Fretboard';
import { Hand } from '../components/Hand';
import { MicGate, Tips } from '../components/common';
import { Tip } from '../feedback/timing';
import { ChordId, CHORDS, Finger } from '../music/chords';
import { SwitchCfg } from '../lessons/lessons';
import { settings } from '../state/settings';
import { progress, recordSwitch } from '../state/progress';

export interface SwitchResult {
  passed: boolean;
  changes: number;
  perMin: number;
}

type Stage = 'intro' | 'countdown' | 'running' | 'result';

interface Props {
  cfg: SwitchCfg;
  onResult?: (r: SwitchResult) => void;
  resultFooter?: (r: SwitchResult) => ReactNode;
}

export function SwitchActivity(props: Props) {
  return (
    <MicGate>
      <SwitchInner {...props} />
    </MicGate>
  );
}

function SwitchInner({ cfg, onResult, resultFooter }: Props) {
  const [stage, setStage] = useState<Stage>('intro');
  const [i, setI] = useState(0); // index into cfg.chords
  const [count, setCount] = useState(0);
  const [msg, setMsg] = useState<{ text: string; good: boolean } | null>(null);
  const [left, setLeft] = useState(cfg.seconds);
  const [flash, setFlash] = useState(0);
  const [result, setResult] = useState<SwitchResult | null>(null);
  const [tips, setTips] = useState<Tip[]>([]);
  const st = useRef({ i: 0, count: 0, busy: false, endAt: 0, times: [] as number[], wrong: 0, unclear: 0, diag: [] as string[], manual: 0 });

  const target = cfg.chords[i % cfg.chords.length];
  const next = cfg.chords[(i + 1) % cfg.chords.length];
  const key = [...new Set(cfg.chords)].sort().join('-');

  const accept = (manual = false) => {
    const s = st.current;
    s.times.push(performance.now());
    s.count++;
    s.i++;
    if (manual) s.manual++;
    setCount(s.count);
    setI(s.i);
    setFlash((f) => f + 1);
    setMsg({ text: manual ? 'Counted.' : `✓ ${CHORDS[cfg.chords[(s.i - 1) % cfg.chords.length]].name} — now ${CHORDS[cfg.chords[s.i % cfg.chords.length]].name}!`, good: true });
  };

  // listen for strums while running
  useEffect(() => {
    if (stage !== 'running') return;
    const off = engine.onOnset(async (o) => {
      const s = st.current;
      if (s.busy) return;
      s.busy = true;
      const want = cfg.chords[s.i % cfg.chords.length];
      const chroma = await engine.captureChromaAfter(o.time);
      s.busy = false;
      if (st.current.endAt < performance.now()) return;
      const set = settings.get();
      const g = classifyChord(chroma, ['emEasy', 'cEasy', 'gEasy'], set.chordMatchMin, set.chordMargin);
      engine.reportChord(g.scores[0] ? CHORDS[g.scores[0].id].name : '?', g.scores[0]?.score ?? 0, `Chord heard: ${g.scores.map((x) => `${CHORDS[x.id].name} ${x.score.toFixed(2)}`).join(', ')}`);
      if (heardChord(g, want, set.chordMatchMin)) return accept();
      if (g.best) {
        s.wrong++;
        setMsg({ text: `That sounded like ${CHORDS[g.best].name}. Switch to ${CHORDS[want].name}, then strum.`, good: false });
      } else {
        s.unclear++;
        const d = diagnoseChord(chroma, CHORDS[want]);
        s.diag.push(...d);
        setMsg({ text: d[0] ?? `That ${CHORDS[want].name} didn’t ring clearly. Press with your fingertip right next to the metal bar.`, good: false });
      }
    });
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Enter') accept(true);
    };
    window.addEventListener('keydown', k);
    const timer = setInterval(() => {
      const l = Math.max(0, Math.ceil((st.current.endAt - performance.now()) / 1000));
      setLeft(l);
      if (l <= 0) finish();
    }, 100);
    return () => {
      off();
      clearInterval(timer);
      window.removeEventListener('keydown', k);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const begin = () => {
    st.current = { i: 0, count: 0, busy: false, endAt: 0, times: [], wrong: 0, unclear: 0, diag: [], manual: 0 };
    setI(0);
    setCount(0);
    setMsg(null);
    setLeft(cfg.seconds);
    setStage('countdown');
    let n = 3;
    setLeft(n);
    const id = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(id);
        st.current.endAt = performance.now() + cfg.seconds * 1000;
        setLeft(cfg.seconds);
        setStage('running');
      } else setLeft(n);
    }, 800);
  };

  const finish = () => {
    const s = st.current;
    if (s.endAt < 0) return; // already finished
    s.endAt = -1;
    // the first chord isn't a change
    const changes = Math.max(0, s.count - 1);
    const perMin = (changes / cfg.seconds) * 60;
    const passed = changes >= cfg.target;
    const t: Tip[] = [];
    if (s.unclear >= 3) {
      const top = mostCommon(s.diag);
      t.push({
        problem: 'Some chords didn’t ring clearly.',
        fix: top ? top.replace(/^.*?Fix: /, '') : 'Press with the very tip of your finger, right next to the metal bar, with your finger curved.',
      });
    }
    if (s.wrong >= 3)
      t.push({
        problem: 'You sometimes strummed before your finger had moved.',
        fix: 'Look at the chord name, place your finger, then strum. Speed comes on its own once the move is automatic.',
      });
    if (!passed)
      t.push({
        problem: `That was ${changes} changes — the goal is ${cfg.target}.`,
        fix: 'Practice just the move 5 times in slow motion without strumming: lift, glide, land. Keep your finger hovering close to the strings.',
      });
    if (s.manual > 0) engine.log(`Switch drill: ${s.manual} changes counted by hand (Enter)`);
    recordSwitch(key, perMin);
    const r = { passed, changes, perMin };
    setTips(t);
    setResult(r);
    setStage('result');
    onResult?.(r);
  };

  const avg =
    st.current.times.length > 1 ? (st.current.times[st.current.times.length - 1] - st.current.times[0]) / 1000 / (st.current.times.length - 1) : null;
  const best = progress.get().bestSwitch[key];
  const fingers = (id: ChordId) => CHORDS[id].strings.flatMap((s) => ('finger' in s ? [s.finger as Finger] : []));

  return (
    <div className="page">
      {stage === 'intro' && (
        <div className="card">
          <h2>{cfg.chords.map((c) => CHORDS[c].name).join(' → ')} switch drill</h2>
          <p className="big">
            Make the chord on screen and strum once. When I hear it, the next chord appears. You have {cfg.seconds} seconds — aim for {cfg.target} changes.
          </p>
          <div className="row gap wrap" style={{ justifyContent: 'center' }}>
            {[...new Set(cfg.chords)].map((id) => (
              <div key={id} className="card" style={{ flex: '1 1 260px' }}>
                <b style={{ fontSize: '1.6rem' }}>{CHORDS[id].name}</b> <span className="muted small">{CHORDS[id].tip}</span>
                <Fretboard chord={CHORDS[id]} small caption={false} spaces={3} />
              </div>
            ))}
          </div>
          {best !== undefined && <p className="muted">Your best so far: {best.toFixed(0)} changes per minute.</p>}
          <button className="btn primary" onClick={begin}>
            Start
          </button>
        </div>
      )}

      {stage === 'countdown' && (
        <div className="card center">
          <p className="big">Make the first chord: {CHORDS[cfg.chords[0]].name}</p>
          <Fretboard chord={CHORDS[cfg.chords[0]]} caption={false} spaces={3} />
          <div className="score-big">{left}</div>
        </div>
      )}

      {stage === 'running' && (
        <div className="card">
          <div className="row gap">
            <div className="timer">⏱ {left}s</div>
            <span className="spacer" />
            <div className="timer">{Math.max(0, count - 1)} changes</div>
          </div>
          <div className="chord-pair" key={flash}>
            <div className={flash ? 'flash-good' : ''} style={{ borderRadius: 14 }}>
              <div className="chord-big">{CHORDS[target].name}</div>
              <Fretboard chord={CHORDS[target]} caption={false} spaces={3} />
            </div>
            <div className="chord-next">
              then
              <b>{CHORDS[next].name}</b>
              <Hand highlight={fingers(target)} />
            </div>
          </div>
          {msg && <div className={`banner ${msg.good ? 'good' : 'info'}`}>{msg.text}</div>}
          <p className="muted small center">Mic not catching a chord you know was right? Press Enter to count it yourself.</p>
        </div>
      )}

      {stage === 'result' && result && (
        <div className="card">
          <div className="row gap wrap">
            <div>
              <div className={`score-big ${result.passed ? 'good-text' : ''}`}>{result.changes} changes</div>
              <div className="muted">
                in {cfg.seconds} seconds{avg ? ` — about one every ${avg.toFixed(1)} s` : ''}
              </div>
            </div>
          </div>
          <h3 style={{ marginTop: '1rem' }}>
            {result.passed ? 'Great switching! Your fingers are learning the way.' : 'Good effort — switching is the hardest early skill. It gets fast quickly.'}
          </h3>
          <Tips tips={tips} />
          <div className="row gap wrap" style={{ marginTop: '1rem' }}>
            <button className="btn" onClick={begin}>
              Go again
            </button>
            <span className="spacer" />
            {resultFooter?.(result)}
          </div>
        </div>
      )}
    </div>
  );
}

function mostCommon(a: string[]) {
  const m = new Map<string, number>();
  a.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
  return [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
}

const DRILLS: { label: string; cfg: SwitchCfg }[] = [
  { label: 'C ↔ G', cfg: { chords: ['cEasy', 'gEasy'], seconds: 30, target: 8 } },
  { label: 'Em ↔ C', cfg: { chords: ['emEasy', 'cEasy'], seconds: 30, target: 10 } },
  { label: 'Em ↔ G', cfg: { chords: ['emEasy', 'gEasy'], seconds: 30, target: 10 } },
  { label: 'G → Em → C → Em', cfg: { chords: ['gEasy', 'emEasy', 'cEasy', 'emEasy'], seconds: 30, target: 8 } },
  { label: 'Em → C → G (song order)', cfg: { chords: ['emEasy', 'cEasy', 'gEasy'], seconds: 30, target: 8 } },
];

export function SwitchPractice() {
  const [d, setD] = useState(0);
  return (
    <div className="page">
      <h1>Chord switch speed drill</h1>
      <p className="lead">Using the easy versions of G, C and Em. Clean first, then fast.</p>
      <select value={d} onChange={(e) => setD(Number(e.target.value))}>
        {DRILLS.map((x, i) => (
          <option key={i} value={i}>
            {x.label}
          </option>
        ))}
      </select>
      <SwitchActivity key={d} cfg={DRILLS[d].cfg} />
    </div>
  );
}
