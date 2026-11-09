import { ReactNode, useEffect, useRef, useState } from 'react';
import { engine } from '../audio/engine';
import { BeatLane } from '../components/BeatLane';
import { Fretboard } from '../components/Fretboard';
import { MicGate, Tips } from '../components/common';
import { summarize, Summary } from '../feedback/timing';
import { ChordId, CHORDS } from '../music/chords';
import { RhythmCfg, SONGS } from '../music/songs';
import { recordRhythm } from '../state/progress';
import { RhythmRun, RunMode } from './rhythmRun';

type Stage = 'intro' | 'watch' | 'afterWatch' | 'tap' | 'afterTap' | 'play' | 'result';

export interface RhythmResult {
  passed: boolean;
  summary: Summary;
  chordAccuracy: number | null;
}

interface Props {
  cfg: RhythmCfg;
  pass?: number;
  song?: boolean;
  /** Skip straight to the intro's play button highlighting (for retries). */
  experienced?: boolean;
  onResult?: (r: RhythmResult) => void;
  resultFooter?: (r: RhythmResult) => ReactNode;
}

export function RhythmActivity({ cfg, pass = 0.6, song, experienced, onResult, resultFooter }: Props) {
  const [stage, setStage] = useState<Stage>('intro');
  const [run, setRun] = useState<RhythmRun | null>(null);
  const [result, setResult] = useState<RhythmResult | null>(null);
  const [tapSummary, setTapSummary] = useState<Summary | null>(null);
  const runRef = useRef<RhythmRun | null>(null);

  useEffect(() => () => runRef.current?.cancel(), []);

  // spacebar taps during the tap stage
  useEffect(() => {
    if (stage !== 'tap') return;
    const k = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) runRef.current?.tap(e.timeStamp);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [stage]);

  const start = async (mode: RunMode) => {
    await engine.ensureContext();
    runRef.current?.cancel();
    const r = new RhythmRun(cfg, mode, (done) => {
      const summary = summarize(done.results(), done.matcher.extras, mode === 'tap' ? 'tap' : 'guitar');
      if (mode === 'watch') setStage('afterWatch');
      else if (mode === 'tap') {
        setTapSummary(summary);
        setStage('afterTap');
      } else {
        const res: RhythmResult = { passed: summary.score >= pass, summary, chordAccuracy: done.chordAccuracy() };
        if (done.topChordTip()) res.summary.tips = [...res.summary.tips, { problem: 'Some chords didn’t sound quite right.', fix: done.topChordTip()!.replace(/^.*?Fix: /, '') }].slice(0, 3);
        recordRhythm(cfg.title, summary.score);
        setResult(res);
        setStage('result');
        onResult?.(res);
      }
    });
    runRef.current = r;
    setRun(r);
    setStage(mode);
  };

  const chordIds = [...new Set(cfg.chords)] as ChordId[];
  const total = cfg.bars * cfg.pattern.length;

  return (
    <div className="page">
      <div className="row gap wrap">
        <h2 style={{ margin: 0 }}>
          {song ? '🎵 ' : ''}
          {cfg.title}
        </h2>
        <span className="tag">{cfg.bpm} beats per minute</span>
        <span className="spacer" />
        <div className="stage-tabs">
          <span className={stage === 'watch' || stage === 'afterWatch' ? 'on' : ''}>Watch</span>
          <span className={stage === 'tap' || stage === 'afterTap' ? 'on' : ''}>Tap</span>
          <span className={stage === 'play' || stage === 'result' ? 'on' : ''}>Play</span>
        </div>
      </div>

      {stage === 'intro' && (
        <>
          <BeatLane preview={cfg} />
          <div className="card">
            <p className="big" style={{ marginTop: 0 }}>
              {cfg.pattern.length === 4
                ? 'Strum once on every beat.'
                : cfg.pattern.length === 1
                  ? 'Strum once at the start of every 4 beats, then let it ring.'
                  : cfg.pattern.length === 2
                    ? 'Strum on beats 1 and 3, let it ring in between.'
                    : `Strum on beats ${cfg.pattern.map((p) => p + 1).join(', ')}.`}{' '}
              {chordIds.length > 1 ? 'The chord name shows where each new chord starts.' : ''}
            </p>
            <div className="row gap wrap">
              <button className={`btn ${experienced ? '' : 'primary'}`} onClick={() => start('watch')}>
                ▶ Watch &amp; listen first
              </button>
              <button className="btn" onClick={() => start('tap')}>
                Tap along (spacebar)
              </button>
              <button className={`btn ${experienced ? 'primary' : ''}`} onClick={() => setStage('play')}>
                🎸 Play with my guitar
              </button>
            </div>
          </div>
          <ChordStrip ids={chordIds} />
        </>
      )}

      {(stage === 'watch' || stage === 'tap' || (stage === 'play' && run?.mode === 'play')) && run && (
        <>
          <BeatLane run={run} onTap={stage === 'tap' ? (t) => run.tap(t) : undefined} />
          <p className="center big">
            {stage === 'watch' && 'Just watch and listen: each dot makes a strum sound when it touches the line.'}
            {stage === 'tap' && 'Tap the spacebar (or click the lane) each time a dot touches the line.'}
            {stage === 'play' && 'Strum when each dot touches the line.'}
          </p>
          <div className="center">
            <button className="btn ghost" onClick={() => run.finish()}>
              Stop
            </button>
          </div>
          {stage === 'play' && <ChordStrip ids={chordIds} small />}
        </>
      )}

      {stage === 'afterWatch' && (
        <div className="card center">
          <p className="big">Got the idea? Try tapping it first — no guitar needed.</p>
          <div className="row gap">
            <button className="btn" onClick={() => start('watch')}>
              Watch again
            </button>
            <button className="btn primary" onClick={() => start('tap')}>
              Tap along (spacebar)
            </button>
            <button className="btn" onClick={() => setStage('play')}>
              Skip to guitar
            </button>
          </div>
        </div>
      )}

      {stage === 'afterTap' && tapSummary && (
        <div className="card center">
          <p className="big">
            {tapSummary.score >= 0.6 ? 'Nice tapping — you’ve got the rhythm. Now with the guitar!' : 'That’s the hard part — the rhythm. Try tapping once more, or go for the guitar.'}
          </p>
          {tapSummary.score < 0.6 && <Tips tips={tapSummary.tips.slice(0, 1)} />}
          <div className="row gap">
            <button className="btn" onClick={() => start('tap')}>
              Tap again
            </button>
            <button className="btn primary" onClick={() => setStage('play')}>
              🎸 Play with my guitar
            </button>
          </div>
        </div>
      )}

      {stage === 'play' && run?.mode !== 'play' && (
        <MicGate>
          <div className="card center">
            <p className="big">Get your guitar ready. There will be 4 clicks to count you in.</p>
            <ChordStrip ids={chordIds} small />
            <button className="btn primary" onClick={() => start('play')}>
              Start
            </button>
          </div>
        </MicGate>
      )}

      {stage === 'result' && result && (
        <div className="card">
          <div className="row gap wrap">
            <div>
              <div className={`score-big ${result.passed ? 'good-text' : ''}`}>
                {result.summary.counts.great + result.summary.counts.good} of {total}
              </div>
              <div className="muted">strums in time</div>
            </div>
            <div className="spacer" />
            <div className="stats">
              <Stat n={result.summary.counts.great} l="right on" />
              <Stat n={result.summary.counts.good} l="close" />
              <Stat n={result.summary.counts.off} l="off" />
              <Stat n={result.summary.counts.miss} l="missed" />
              <Stat n={result.summary.counts.extra} l="extra" />
              {result.chordAccuracy !== null && chordIds.length > 0 && <Stat n={`${Math.round(result.chordAccuracy * 100)}%`} l="chords clear" />}
            </div>
          </div>
          <h3 style={{ marginTop: '1rem' }}>{result.summary.headline}</h3>
          <Tips tips={result.summary.tips} />
          <div className="row gap wrap" style={{ marginTop: '1rem' }}>
            <button className="btn" onClick={() => start('play')}>
              Play again
            </button>
            <button className="btn ghost" onClick={() => start('watch')}>
              Watch again
            </button>
            <span className="spacer" />
            {resultFooter?.(result)}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ n, l }: { n: number | string; l: string }) {
  return (
    <div className="stat">
      <b>{n}</b>
      <span>{l}</span>
    </div>
  );
}

export function ChordStrip({ ids, small }: { ids: ChordId[]; small?: boolean }) {
  return (
    <div className="row gap wrap" style={{ justifyContent: 'center' }}>
      {ids.map((id) => (
        <div key={id} className="card" style={{ padding: '0.6rem', flex: small ? '0 1 320px' : '1 1 320px' }}>
          <div className="row gap">
            <b style={{ fontSize: '1.5rem' }}>{CHORDS[id].name}</b>
            <span className="muted small">{CHORDS[id].version}</span>
          </div>
          <Fretboard chord={CHORDS[id]} small caption={false} spaces={3} />
        </div>
      ))}
    </div>
  );
}

// ---------------- standalone practice page ----------------

const PRESETS: { label: string; cfg: RhythmCfg }[] = [
  { label: 'Once per bar', cfg: { title: 'Once per bar', bpm: 60, bars: 4, pattern: [0], chords: ['emEasy'] } },
  { label: 'Beats 1 and 3', cfg: { title: 'Beats 1 and 3', bpm: 60, bars: 4, pattern: [0, 2], chords: ['emEasy'] } },
  { label: 'Every beat', cfg: { title: 'Every beat', bpm: 60, bars: 4, pattern: [0, 1, 2, 3], chords: ['emEasy'] } },
  { label: 'Song: First Light', cfg: SONGS.firstLight },
  { label: 'Song: Back Porch', cfg: SONGS.backPorch },
  { label: 'Song: Open Road', cfg: SONGS.openRoad },
];

export function RhythmPractice() {
  const [preset, setPreset] = useState(0);
  const [bpm, setBpm] = useState(PRESETS[0].cfg.bpm);
  const cfg = { ...PRESETS[preset].cfg, bpm };
  return (
    <div className="page">
      <h1>Strum on the beat</h1>
      <p className="lead">Strum when the dot touches the line. Start slow — slow and steady beats fast and messy.</p>
      <div className="row gap wrap">
        <select
          value={preset}
          onChange={(e) => {
            const i = Number(e.target.value);
            setPreset(i);
            setBpm(PRESETS[i].cfg.bpm);
          }}
        >
          {PRESETS.map((p, i) => (
            <option key={i} value={i}>
              {p.label}
            </option>
          ))}
        </select>
        <label className="row gap">
          Speed
          <input type="range" min={40} max={110} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
          <b>{bpm}</b>
        </label>
      </div>
      <RhythmActivity key={`${preset}-${bpm}`} cfg={cfg} song={!!cfg.lyrics} />
    </div>
  );
}
