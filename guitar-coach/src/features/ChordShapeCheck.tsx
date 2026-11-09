import { ReactNode, useEffect, useRef, useState } from 'react';
import { engine } from '../audio/engine';
import { classifyChord, diagnoseChord, heardChord } from '../audio/chroma';
import { playNote, playStrum } from '../audio/synth';
import { Fretboard, StringMark } from '../components/Fretboard';
import { Hand } from '../components/Hand';
import { MicGate } from '../components/common';
import { Chord, chordNotes, ChordId, CHORDS, FINGER_COLOR_WORDS, FINGER_NAMES, Finger, playedStrings } from '../music/chords';
import { foldedCents, OPEN_STRINGS, stringName } from '../music/notes';
import { settings } from '../state/settings';

interface Props {
  chord: ChordId;
  onlyStrings?: number[];
  /** Called with passed=false each time a string or strum fails twice, true when the chord rings. */
  onResult?: (passed: boolean) => void;
  doneFooter?: ReactNode;
}

export function ShapeActivity(props: Props) {
  return (
    <MicGate>
      <ShapeInner {...props} />
    </MicGate>
  );
}

type Verdict = { ok: boolean; text: string };

/** Judge one plucked string from the pitches heard after the pluck. */
export function judgeString(chord: Chord, i: number, pitches: number[]): Verdict {
  const s = chord.strings[i];
  const expected = chordNotes(chord)[i]!;
  if (pitches.length < 3) {
    return {
      ok: false,
      text: 'That string sounds muffled — something is touching it. Fix: curve your fingers so only the very tips touch the strings, like you’re holding a small ball.',
    };
  }
  const sorted = [...pitches].sort((a, b) => a - b);
  const hz = sorted[Math.floor(sorted.length / 2)];
  const c = foldedCents(hz, expected);
  if (Math.abs(c) < 60) return { ok: true, text: 'Rings clear!' };
  if (s.fret !== 'x' && s.fret > 0 && 'finger' in s) {
    const f = s.finger as Finger;
    const who = `${FINGER_NAMES[f]} finger (${FINGER_COLOR_WORDS[f]})`;
    if (Math.abs(foldedCents(hz, OPEN_STRINGS[i])) < 60)
      return { ok: false, text: `I hear the string ringing as if nothing is pressing it. Fix: press down with the tip of your ${who}, right next to the metal bar.` };
    const semis = Math.round(c / 100);
    if (semis === 1) return { ok: false, text: `Close! Your ${who} is one space too far from the end of the neck. Fix: slide it one space toward the end of the neck, into space ${s.fret}.` };
    if (semis === -1) return { ok: false, text: `Close! Your ${who} is one space too close to the end of the neck. Fix: slide it one space away from the end, into space ${s.fret}.` };
  }
  if (Math.abs(c) < 120) return { ok: false, text: 'Almost — it sounds slightly off. Fix: press straight down, not sideways, and check the string is still in tune.' };
  return { ok: false, text: `That sounded like a different string. Fix: pick just the ${stringName(i)} (it’s lit up in the picture).` };
}

function ShapeInner({ chord: id, onlyStrings, onResult, doneFooter }: Props) {
  const chord = CHORDS[id];
  const toCheck = onlyStrings ?? playedStrings(chord);
  const [stage, setStage] = useState<'pluck' | 'strum' | 'done'>('pluck');
  const [k, setK] = useState(0); // index into toCheck
  const [marks, setMarks] = useState<Partial<Record<number, StringMark>>>({});
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [fails, setFails] = useState(0);
  const busy = useRef(false);
  const cur = toCheck[k];

  // pluck stage: after each pluck, collect pitch readings for ~0.6 s
  useEffect(() => {
    if (stage !== 'pluck' || cur === undefined) return;
    const off = engine.onOnset(() => {
      if (busy.current) return;
      busy.current = true;
      const pitches: number[] = [];
      const start = performance.now();
      const id = setInterval(() => {
        const p = engine.readPitch();
        if (p && p.hz) pitches.push(p.hz);
        if (performance.now() - start > 650) {
          clearInterval(id);
          busy.current = false;
          const v = judgeString(chord, cur, pitches.slice(1)); // skip the scratchy first reading
          setVerdict(v);
          if (v.ok) {
            setMarks((m) => ({ ...m, [cur]: 'ok' }));
            setFails(0);
            setTimeout(() => {
              setVerdict(null);
              if (k + 1 < toCheck.length) setK(k + 1);
              else setStage(onlyStrings ? 'done' : 'strum');
            }, 700);
          } else {
            setMarks((m) => ({ ...m, [cur]: 'bad' }));
            setFails((f) => {
              if (f + 1 === 2) onResult?.(false);
              return f + 1;
            });
          }
        }
      }, 40);
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, k]);

  useEffect(() => {
    if (stage === 'done' && onlyStrings) onResult?.(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // strum stage: check the whole chord
  useEffect(() => {
    if (stage !== 'strum') return;
    const off = engine.onOnset(async (o) => {
      if (busy.current) return;
      busy.current = true;
      const chroma = await engine.captureChromaAfter(o.time, 120, 450);
      busy.current = false;
      const s = settings.get();
      const g = classifyChord(chroma, ['emEasy', 'cEasy', 'gEasy'], s.chordMatchMin, s.chordMargin);
      engine.reportChord(g.scores[0] ? CHORDS[g.scores[0].id].name : '?', g.scores[0]?.score ?? 0, `Chord heard: ${g.scores.map((x) => `${CHORDS[x.id].name} ${x.score.toFixed(2)}`).join(', ')}`);
      if (heardChord(g, chord.id, s.chordMatchMin)) {
        setVerdict({ ok: true, text: `That’s a ${chord.name} chord!` });
        setStage('done');
        onResult?.(true);
      } else {
        const tips = diagnoseChord(chroma, chord);
        setVerdict({
          ok: false,
          text: tips[0] ?? (g.best ? `That sounded more like ${CHORDS[g.best].name}. Check the picture and try again.` : 'Not quite clear yet. Strum only the strings marked in the picture, and let them ring.'),
        });
        setFails((f) => {
          if (f + 1 === 2) onResult?.(false);
          return f + 1;
        });
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const hear = async () => {
    const ctx = await engine.ensureContext();
    if (stage === 'pluck' && cur !== undefined) playNote(ctx, engine.out, chordNotes(chord)[cur]!, ctx.currentTime + 0.05);
    else playStrum(ctx, engine.out, chord, ctx.currentTime + 0.05);
  };

  const skip = () => {
    setVerdict(null);
    setFails(0);
    if (stage === 'pluck') {
      if (k + 1 < toCheck.length) setK(k + 1);
      else setStage(onlyStrings ? 'done' : 'strum');
    } else {
      setStage('done');
      onResult?.(true);
    }
  };

  const showMarks: Partial<Record<number, StringMark>> = { ...marks };
  if (stage === 'pluck' && cur !== undefined && marks[cur] !== 'bad') showMarks[cur] = 'active';
  const fingers = chord.strings.flatMap((s) => ('finger' in s ? [s.finger as Finger] : []));

  return (
    <div className="card">
      <div className="row gap wrap">
        <h2 style={{ margin: 0 }}>{chord.name}</h2>
        <span className="muted">{chord.version}</span>
      </div>
      <p className="muted">{chord.tip}</p>
      <div className="two-col" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <Fretboard chord={chord} marks={showMarks} spaces={3} />
        {fingers.length > 0 ? <Hand highlight={fingers} /> : <p className="center big">No fingers needed!</p>}
      </div>

      {stage === 'pluck' && cur !== undefined && (
        <p className="big">
          Hold the shape. Now pick <b>only the {stringName(cur)}</b> and let it ring.{' '}
          {toCheck.length > 1 && (
            <span className="muted">
              ({k + 1} of {toCheck.length})
            </span>
          )}
        </p>
      )}
      {stage === 'strum' && <p className="big">Every string rings! Now strum them all together, from the {stringName(toCheck[0])} down.</p>}
      {verdict && <div className={`banner ${verdict.ok ? 'good' : 'info'}`}>{verdict.text}</div>}

      <div className="row gap wrap" style={{ marginTop: '1rem' }}>
        {stage !== 'done' && (
          <button className="btn ghost" onClick={hear}>
            🔊 Hear how it should sound
          </button>
        )}
        <span className="spacer" />
        {stage !== 'done' && fails >= 2 && (
          <button className="btn ghost" onClick={skip}>
            It sounded right to me — move on
          </button>
        )}
        {stage === 'done' && doneFooter}
      </div>
    </div>
  );
}
