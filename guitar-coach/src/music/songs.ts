import { ChordId } from './chords';

/** A rhythm exercise or song: strums land on beats, chords change per bar. */
export interface RhythmCfg {
  title: string;
  bpm: number;
  bars: number;
  /** Which beats of each 4-beat bar get a strum, e.g. [0] or [0, 2] or [0, 1, 2, 3]. */
  pattern: number[];
  /** Chord for each bar (repeats if shorter than bars). */
  chords: ChordId[];
  /** Words for each bar (optional, songs only). */
  lyrics?: string[];
  /** Drum backing (songs). */
  backing?: boolean;
}

export const BEATS_PER_BAR = 4;

// All songs here are originals written for this app.

export const SONGS: Record<string, RhythmCfg> = {
  firstLight: {
    title: 'First Light',
    bpm: 66,
    bars: 8,
    pattern: [0, 1, 2, 3],
    chords: ['emEasy'],
    backing: true,
    lyrics: ['Wake up slow,', 'sky is grey,', "coffee's on,", "it's a brand new day.", 'One chord', 'is all I need,', 'one chord', "and I'm free."],
  },
  backPorch: {
    title: 'Back Porch',
    bpm: 66,
    bars: 8,
    pattern: [0, 2],
    chords: ['gEasy', 'gEasy', 'cEasy', 'cEasy', 'gEasy', 'gEasy', 'cEasy', 'gEasy'],
    backing: true,
    lyrics: ['Sitting on the', 'back porch,', 'watching the sun', 'go down.', 'Nothing to do,', 'nowhere to be,', 'best seat', 'in town.'],
  },
  openRoad: {
    title: 'Open Road',
    bpm: 70,
    bars: 8,
    pattern: [0, 1, 2, 3],
    chords: ['emEasy', 'cEasy', 'gEasy', 'gEasy'],
    backing: true,
    lyrics: ['Open road,', 'running free,', 'radio on,', 'just you and me.', 'Windows down,', 'wind in the trees,', 'singing along', 'to the melody.'],
  },
};
