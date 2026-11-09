import { OPEN_STRINGS, pitchClass } from './notes';

export type Finger = 1 | 2 | 3 | 4;

/** One entry per string, thickest (0) to thinnest (5). */
export type StringShape = { fret: 'x' } | { fret: 0 } | { fret: number; finger: Finger };

export type ChordId = 'emEasy' | 'cEasy' | 'gEasy' | 'emFull' | 'cFull' | 'gFull';

export interface Chord {
  id: ChordId;
  /** Short name shown big on screen. */
  name: string;
  /** Root note name as 0-11 (C=0), used for the backing bass. */
  root: number;
  /** Which version this is, in plain words. */
  version: string;
  strings: StringShape[];
  /** One-line tip for making the shape. */
  tip: string;
}

const X = { fret: 'x' } as const;
const O = { fret: 0 } as const;
const F = (fret: number, finger: Finger) => ({ fret, finger });

export const CHORDS: Record<ChordId, Chord> = {
  emEasy: {
    id: 'emEasy',
    name: 'Em',
    root: 4,
    version: 'Easy version — no fingers at all',
    strings: [X, X, X, O, O, O],
    tip: 'Just strum the 3 thinnest strings. Nothing to press!',
  },
  cEasy: {
    id: 'cEasy',
    name: 'C',
    root: 0,
    version: 'Easy version — 1 finger',
    strings: [X, X, X, O, F(1, 1), O],
    tip: 'Pointer finger (blue) on the 2nd-thinnest string, in space 1.',
  },
  gEasy: {
    id: 'gEasy',
    name: 'G',
    root: 7,
    version: 'Easy version — 1 finger',
    strings: [X, X, X, O, O, F(3, 3)],
    tip: 'Ring finger (orange) on the thinnest string, in space 3.',
  },
  emFull: {
    id: 'emFull',
    name: 'Em',
    root: 4,
    version: 'Full version — 2 fingers',
    strings: [O, F(2, 2), F(2, 3), O, O, O],
    tip: 'Middle and ring fingers side by side in space 2. Strum all 6 strings.',
  },
  cFull: {
    id: 'cFull',
    name: 'C',
    root: 0,
    version: 'Fuller version — 3 fingers',
    strings: [X, F(3, 3), F(2, 2), O, F(1, 1), O],
    tip: 'Fingers go down like a staircase: ring, middle, pointer.',
  },
  gFull: {
    id: 'gFull',
    name: 'G',
    root: 7,
    version: 'Full version — 3 fingers',
    strings: [F(3, 2), F(2, 1), O, O, O, F(3, 3)],
    tip: 'Pointer and middle on the two thickest strings, ring on the thinnest.',
  },
};

/** Sounding MIDI notes for each played string (null = don't play). */
export function chordNotes(c: Chord): (number | null)[] {
  return c.strings.map((s, i) => (s.fret === 'x' ? null : OPEN_STRINGS[i] + s.fret));
}

/** Which strings are strummed, e.g. [3,4,5]. */
export function playedStrings(c: Chord): number[] {
  return c.strings.map((s, i) => (s.fret === 'x' ? -1 : i)).filter((i) => i >= 0);
}

export function chordPitchClasses(c: Chord): Set<number> {
  return new Set(chordNotes(c).filter((n): n is number => n !== null).map(pitchClass));
}

export const FINGER_COLORS: Record<Finger, string> = {
  1: '#2f7de1', // blue
  2: '#1fa45a', // green
  3: '#ef8a17', // orange
  4: '#9b4dd8', // purple
};
export const FINGER_NAMES: Record<Finger, string> = {
  1: 'pointer',
  2: 'middle',
  3: 'ring',
  4: 'pinky',
};
export const FINGER_COLOR_WORDS: Record<Finger, string> = {
  1: 'blue',
  2: 'green',
  3: 'orange',
  4: 'purple',
};
