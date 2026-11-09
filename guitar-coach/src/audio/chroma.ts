import { Chord, ChordId, CHORDS, chordNotes, chordPitchClasses, FINGER_NAMES, FINGER_COLOR_WORDS, Finger } from '../music/chords';
import { OPEN_STRINGS, pitchClass, stringName } from '../music/notes';

/**
 * "Chroma" = how much energy is in each of the 12 note names, ignoring octave.
 * We compare a strum's chroma to what each chord should sound like.
 */
export function chromaFromSpectrum(db: Float32Array, sampleRate: number, fftSize: number): Float32Array {
  const chroma = new Float32Array(12);
  const binHz = sampleRate / fftSize;
  const lo = Math.floor(150 / binHz);
  const hi = Math.min(db.length - 2, Math.ceil(2500 / binHz));
  for (let b = lo; b <= hi; b++) {
    // only spectral peaks: reduces smearing between neighbouring notes
    if (!(db[b] > db[b - 1] && db[b] >= db[b + 1])) continue;
    const mag = Math.pow(10, db[b] / 20);
    const f = b * binHz;
    const m = 69 + 12 * Math.log2(f / 440);
    const nearest = Math.round(m);
    const dev = Math.abs(m - nearest); // 0..0.5 semitones
    const w = Math.cos(dev * Math.PI); // 1 when spot-on, 0 when exactly between notes
    if (w <= 0) continue;
    chroma[pitchClass(nearest)] += mag * mag * w;
  }
  return chroma;
}

export function normalize(v: Float32Array): Float32Array {
  // compress so one loud string doesn't swamp the others
  const out = new Float32Array(v.length);
  let n = 0;
  for (let i = 0; i < v.length; i++) {
    out[i] = Math.sqrt(Math.max(0, v[i]));
    n += out[i] * out[i];
  }
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) out[i] /= n;
  return out;
}

/** Expected chroma for a chord, including the first few overtones of each string. */
export function chordTemplate(c: Chord): Float32Array {
  const t = new Float32Array(12);
  for (const n of chordNotes(c)) {
    if (n === null) continue;
    // partials 1..6 with falling strength
    const partials = [0, 12, 19, 24, 28, 31];
    partials.forEach((p, k) => {
      t[pitchClass(n + p)] += 1 / (k + 1);
    });
  }
  return normalize(t.map((x) => x * x) as Float32Array);
}

function dot(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export interface ChordGuess {
  best: ChordId | null;
  scores: { id: ChordId; score: number }[];
}

export function classifyChord(chroma: Float32Array, candidates: ChordId[], minScore: number, margin: number): ChordGuess {
  const c = normalize(chroma);
  const scores = candidates
    .map((id) => ({ id, score: dot(c, chordTemplate(CHORDS[id])) }))
    .sort((a, b) => b.score - a.score);
  const top = scores[0];
  const second = scores[1];
  const ok = top && top.score >= minScore && (!second || top.score - second.score >= margin);
  return { best: ok ? top.id : null, scores };
}

/** Did the strum sound like the chord we asked for? (top match and above the minimum) */
export function heardChord(g: ChordGuess, want: ChordId, minScore: number): boolean {
  const top = g.scores[0];
  return !!top && top.score >= minScore && CHORDS[top.id].name === CHORDS[want].name;
}

/**
 * Look for signs of common mistakes in a strum and describe them in plain words,
 * each with a fix. Based on which notes are present that shouldn't be.
 */
export function diagnoseChord(chroma: Float32Array, chord: Chord): string[] {
  const c = normalize(chroma);
  const t = chordTemplate(chord);
  const want = chordPitchClasses(chord);
  const avg = (v: Float32Array) => [...want].reduce((s, pc) => s + v[pc], 0) / want.size || 1;
  const cAvg = avg(c);
  const tAvg = avg(t);
  // how much MORE of a note we hear than the chord's own overtones would explain
  const excess = (pc: number) => c[pc] / cAvg - t[pc] / tAvg;
  const tips: string[] = [];
  chord.strings.forEach((s, i) => {
    const openPc = pitchClass(OPEN_STRINGS[i]);
    if (want.has(openPc)) return; // can't tell from chroma alone
    if (excess(openPc) < 0.45) return;
    if (s.fret === 'x') {
      tips.push(`It sounds like the ${stringName(i)} is ringing too. Fix: start your strum lower down, on the ${stringName(firstPlayed(chord))}.`);
    } else if (s.fret > 0 && 'finger' in s) {
      const f = s.finger as Finger;
      tips.push(
        `The ${stringName(i)} sounds un-pressed. Fix: press it firmly with the tip of your ${FINGER_NAMES[f]} finger (${FINGER_COLOR_WORDS[f]}), right next to the metal bar.`,
      );
    }
  });
  return dedupe(tips);
}

function firstPlayed(c: Chord) {
  return c.strings.findIndex((s) => s.fret !== 'x');
}
function dedupe(a: string[]) {
  return [...new Set(a)];
}
