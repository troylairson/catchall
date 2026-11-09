import { describe, it, expect } from 'vitest';
import { classifyChord, chordTemplate, diagnoseChord } from '../audio/chroma';
import { CHORDS } from '../music/chords';
import { foldedCents, midiToHz, nearestString } from '../music/notes';

describe('chords', () => {
  it('recognizes each easy chord from its own template', () => {
    for (const id of ['emEasy', 'cEasy', 'gEasy'] as const) {
      const t = chordTemplate(CHORDS[id]).map((x) => x * x) as Float32Array;
      expect(classifyChord(t, ['emEasy', 'cEasy', 'gEasy'], 0.6, 0.02).best).toBe(id);
    }
  });
  it('says the C finger is not pressing when open B rings instead of C', () => {
    // a C shape with the finger not pressing sounds like open G-B-E = Em
    const t = chordTemplate(CHORDS.emEasy).map((x) => x * x) as Float32Array;
    const tips = diagnoseChord(t, CHORDS.cEasy);
    expect(tips.join(' ')).toMatch(/2nd-thinnest string sounds un-pressed/);
  });
});

describe('notes', () => {
  it('folds octave errors', () => {
    expect(Math.round(foldedCents(midiToHz(52), 40))).toBe(0);
    expect(Math.round(foldedCents(midiToHz(40.2), 40))).toBe(20);
  });
  it('finds the nearest string', () => {
    expect(nearestString(110).string).toBe(1);
    expect(nearestString(330).string).toBe(5);
  });
});

describe('diagnosis does not blame overtones', () => {
  it('a clean C strum gives no tips for C', () => {
    const t = chordTemplate(CHORDS.cEasy).map((x) => x * x) as Float32Array;
    expect(diagnoseChord(t, CHORDS.cEasy)).toEqual([]);
  });
  it('a C strum checked against Em does not claim thick strings are ringing', () => {
    const t = chordTemplate(CHORDS.cEasy).map((x) => x * x) as Float32Array;
    expect(diagnoseChord(t, CHORDS.emEasy).join(' ')).not.toMatch(/ringing too/);
  });
  it('flags thick strings when an open A really rings', () => {
    const t = chordTemplate(CHORDS.emEasy).map((x) => x * x) as Float32Array;
    t[9] += 0.5; // lots of A
    expect(diagnoseChord(t, CHORDS.emEasy).join(' ')).toMatch(/2nd-thickest string is ringing too/);
  });
});
