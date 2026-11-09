import { describe, it, expect } from 'vitest';
import { BeatMatcher, summarize, label } from '../feedback/timing';

const W = { greatWindowMs: 60, okWindowMs: 120, missWindowMs: 260 };
const beats = (n: number, bpm = 60) => Array.from({ length: n }, (_, i) => ({ time: 1 + (i * 60) / bpm, index: i }));

describe('BeatMatcher', () => {
  it('classifies hits by distance from the beat', () => {
    const m = new BeatMatcher(beats(4), W);
    expect(m.addStrum(1.02)!.kind).toBe('great');
    expect(m.addStrum(1.9)!.kind).toBe('good');
    expect(label(m.results[1]!)).toBe('A little early');
    expect(m.addStrum(3.2)!.kind).toBe('off');
    expect(m.addStrum(3.6)).toBeNull(); // nothing within 260ms
    expect(m.extras).toBe(1);
    expect(m.expire(10).map((r) => r.index)).toEqual([3]);
    expect(m.done()).toBe(true);
  });
  it('does not match two strums to the same beat', () => {
    const m = new BeatMatcher(beats(2), W);
    m.addStrum(1.0);
    expect(m.addStrum(1.05)).toBeNull();
  });
});

describe('summarize', () => {
  const hits = (offs: (number | null)[]) =>
    offs.map((o, i) => ({ index: i, offsetMs: o, kind: o === null ? 'miss' : Math.abs(o) <= 60 ? 'great' : Math.abs(o) <= 120 ? 'good' : 'off' }) as any);
  it('praises steady on-time playing', () => {
    const s = summarize(hits([5, -10, 0, 12, -5, 8, 0, 3]), 0);
    expect(s.score).toBeGreaterThan(0.9);
    expect(s.tips).toHaveLength(0);
  });
  it('spots rushing and gives a fix', () => {
    const s = summarize(hits([-80, -70, -90, -75, -85, -80, -70, -90]), 0);
    expect(s.tips[0].problem).toMatch(/before the beat/);
    expect(s.tips[0].fix.length).toBeGreaterThan(10);
  });
  it('spots dragging', () => {
    expect(summarize(hits([80, 70, 90, 75, 85, 80]), 0).tips[0].problem).toMatch(/after the beat/);
  });
  it('spots not being heard', () => {
    expect(summarize(hits([null, null, null, 0, null, null]), 0).tips[0].problem).toMatch(/didn't hear/);
  });
  it('spots speeding up', () => {
    const s = summarize(hits([40, 30, 20, 10, -40, -50, -60, -70]), 0);
    expect(s.tips.some((t) => /faster/.test(t.problem))).toBe(true);
  });
  it('penalizes extra strums', () => {
    const s = summarize(hits([0, 0, 0, 0]), 4);
    expect(s.score).toBeLessThan(0.6);
    expect(s.tips.some((t) => /extra strums/.test(t.problem))).toBe(true);
  });
});
