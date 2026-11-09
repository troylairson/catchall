/** Note math. Strings are indexed 0 = thickest ... 5 = thinnest. */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Standard tuning, thickest to thinnest, as MIDI numbers. */
export const OPEN_STRINGS = [40, 45, 50, 55, 59, 64];
export const OPEN_LETTERS = ['E', 'A', 'D', 'G', 'B', 'e'];

export function midiToHz(m: number) {
  return 440 * Math.pow(2, (m - 69) / 12);
}
export function hzToMidi(hz: number) {
  return 69 + 12 * Math.log2(hz / 440);
}
export function pitchClass(midi: number) {
  return ((Math.round(midi) % 12) + 12) % 12;
}
/** Cents from target, folded into -600..600 so octave mistakes don't matter. */
export function foldedCents(hz: number, targetMidi: number) {
  let c = (hzToMidi(hz) - targetMidi) * 100;
  c = ((((c + 600) % 1200) + 1200) % 1200) - 600;
  return c;
}

/** Plain-English string names, no letters needed. */
export function stringName(i: number): string {
  return [
    'thickest string',
    '2nd-thickest string',
    '3rd-thickest string',
    '3rd-thinnest string',
    '2nd-thinnest string',
    'thinnest string',
  ][i];
}

/** Which open string is this pitch closest to (in raw cents)? */
export function nearestString(hz: number): { string: number; cents: number } {
  const m = hzToMidi(hz);
  let best = 0;
  let bestD = Infinity;
  OPEN_STRINGS.forEach((s, i) => {
    const d = Math.abs(m - s);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return { string: best, cents: (m - OPEN_STRINGS[best]) * 100 };
}
