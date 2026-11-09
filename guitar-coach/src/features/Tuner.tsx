import { useEffect, useRef, useState } from 'react';
import { engine } from '../audio/engine';
import { Fretboard, StringMark } from '../components/Fretboard';
import { MicGate } from '../components/common';
import { foldedCents, hzToMidi, nearestString, OPEN_STRINGS, stringName } from '../music/notes';
import { settings } from '../state/settings';

interface Reading {
  string: number;
  cents: number;
  hz: number;
}

export function Tuner({ onDone }: { onDone?: () => void }) {
  return (
    <MicGate>
      <TunerInner onDone={onDone} />
    </MicGate>
  );
}

function TunerInner({ onDone }: { onDone?: () => void }) {
  const [locked, setLocked] = useState<number | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [good, setGood] = useState<boolean[]>([false, false, false, false, false, false]);
  const [silent, setSilent] = useState(true);
  const hist = useRef<number[]>([]);
  const cur = useRef<number | null>(null);
  const switchVotes = useRef(0);
  const goodSince = useRef<number | null>(null);
  const lastHeard = useRef(0);
  const { tunerToleranceCents: tol } = settings.use();

  useEffect(() => {
    const id = setInterval(() => {
      const p = engine.readPitch();
      const now = performance.now();
      if (!p || !p.hz) {
        if (now - lastHeard.current > 1200) {
          setSilent(true);
          setReading(null);
          hist.current = [];
          goodSince.current = null;
        }
        return;
      }
      lastHeard.current = now;
      setSilent(false);

      // which string? locked, or nearest (with a little hysteresis so it doesn't flicker)
      let s: number;
      if (locked !== null) s = locked;
      else {
        const n = nearestString(p.hz).string;
        if (cur.current === null || n === cur.current) {
          s = n;
          switchVotes.current = 0;
        } else if (++switchVotes.current >= 3) {
          s = n;
          switchVotes.current = 0;
          hist.current = [];
        } else s = cur.current;
      }
      if (s !== cur.current) hist.current = [];
      cur.current = s;

      const c = locked !== null ? foldedCents(p.hz, OPEN_STRINGS[s]) : (hzToMidi(p.hz) - OPEN_STRINGS[s]) * 100;
      hist.current = [...hist.current, c].slice(-7);
      const sorted = [...hist.current].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      setReading({ string: s, cents: med, hz: p.hz });

      if (Math.abs(med) <= tol && hist.current.length >= 3) {
        if (goodSince.current === null) goodSince.current = now;
        if (now - goodSince.current > 700) {
          setGood((g) => (g[s] ? g : g.map((v, i) => (i === s ? true : v))));
        }
      } else goodSince.current = null;
    }, 40);
    return () => clearInterval(id);
  }, [locked, tol]);

  const allGood = good.every(Boolean);
  const doneRef = useRef(false);
  useEffect(() => {
    if (allGood && !doneRef.current) {
      doneRef.current = true;
      onDone?.();
    }
  }, [allGood, onDone]);

  const marks: Partial<Record<number, StringMark>> = {};
  good.forEach((g, i) => g && (marks[i] = 'ok'));
  if (reading) marks[reading.string] = 'active';
  else if (locked !== null) marks[locked] = 'active';

  const verdict = !reading
    ? null
    : Math.abs(reading.cents) <= tol
      ? { word: 'Good!', cls: 'good', sub: 'Leave this one alone.' }
      : reading.cents < 0
        ? { word: 'Tighten', cls: 'tight', sub: 'It sounds too low. Turn the peg to tighten — slowly.' }
        : { word: 'Loosen', cls: 'loose', sub: 'It sounds too high. Turn the peg to loosen — slowly.' };
  const wayOff = reading && Math.abs(reading.cents) > 150;
  const nextUntuned = good.findIndex((g) => !g);

  return (
    <div className="tuner">
      <div className={`tuner-verdict ${verdict?.cls ?? ''}`}>
        {verdict ? (
          <>
            <div className="tuner-word">{verdict.word}</div>
            <div className="tuner-sub">
              {stringName(reading!.string)} · {verdict.sub}
            </div>
          </>
        ) : (
          <>
            <div className="tuner-word idle">{silent ? 'Play a string' : '…'}</div>
            <div className="tuner-sub">
              {nextUntuned >= 0 ? `Try the ${stringName(locked ?? nextUntuned)}. Pick it once and let it ring.` : 'All strings are in tune!'}
            </div>
          </>
        )}
      </div>

      <Needle cents={reading?.cents ?? null} tol={tol} />

      {wayOff && (
        <p className="hint">
          That’s a long way off. If you’re sure it’s the {stringName(reading!.string)}, keep tightening/loosening — or tap that string
          below to lock onto it.
        </p>
      )}

      <Fretboard marks={marks} onStringClick={(i) => setLocked(locked === i ? null : i)} spaces={3} />
      <div className="row wrap gap">
        {good.map((g, i) => (
          <button key={i} className={`chip ${g ? 'ok' : ''} ${locked === i ? 'sel' : ''}`} onClick={() => setLocked(locked === i ? null : i)}>
            {g ? '✓ ' : ''}
            {stringName(i)}
          </button>
        ))}
      </div>
      <p className="muted small">
        {locked === null ? 'I’ll guess which string you’re playing. Tap a string to lock onto it.' : `Locked on the ${stringName(locked)}. Tap it again to unlock.`}
      </p>
      {allGood && <div className="banner good">All 6 strings are in tune. 🎉</div>}
    </div>
  );
}

function Needle({ cents, tol }: { cents: number | null; tol: number }) {
  const c = cents === null ? 0 : Math.max(-50, Math.min(50, cents));
  const angle = (c / 50) * 60;
  const inTune = cents !== null && Math.abs(cents) <= tol;
  const tolAngle = (tol / 50) * 60;
  const arc = (a: number) => {
    const r = (a - 90) * (Math.PI / 180);
    return [100 + 80 * Math.cos(r), 100 + 80 * Math.sin(r)];
  };
  const [x1, y1] = arc(-tolAngle);
  const [x2, y2] = arc(tolAngle);
  return (
    <svg viewBox="0 0 200 115" className="needle" aria-hidden>
      <path d={`M ${arc(-60).join(' ')} A 80 80 0 0 1 ${arc(60).join(' ')}`} fill="none" stroke="var(--line)" strokeWidth={10} strokeLinecap="round" />
      <path d={`M ${x1} ${y1} A 80 80 0 0 1 ${x2} ${y2}`} fill="none" stroke="var(--good)" strokeWidth={10} />
      <text x={22} y={112} className="needle-label">
        too low
      </text>
      <text x={178} y={112} className="needle-label" textAnchor="end">
        too high
      </text>
      {cents !== null && (
        <line
          x1={100}
          y1={100}
          x2={100}
          y2={28}
          stroke={inTune ? 'var(--good)' : 'var(--ink)'}
          strokeWidth={4}
          strokeLinecap="round"
          style={{ transform: `rotate(${angle}deg)`, transformOrigin: '100px 100px', transition: 'transform 80ms linear' }}
        />
      )}
      <circle cx={100} cy={100} r={6} fill="var(--ink)" />
    </svg>
  );
}
