import { describe, it, expect } from 'vitest';
import { LESSONS } from '../lessons/lessons';
import { emptyProgress, recordResult, visibleSteps, currentIndex } from '../lessons/path';

const l3 = LESSONS.find((l) => l.id === 3)!;

describe('lesson path', () => {
  it('has 10 lessons with unique step ids', () => {
    expect(LESSONS).toHaveLength(10);
    const ids = LESSONS.flatMap((l) => l.steps.flatMap((s) => [s.id, ...('smaller' in s && s.smaller ? s.smaller.map((x) => x.id) : [])]));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('lesson 3 ends with a song (early win)', () => {
    const last = l3.steps[l3.steps.length - 1];
    expect(last.kind === 'rhythm' && last.song).toBe(true);
  });
  it('adds a smaller step after two fails, then an even smaller one', () => {
    let p = emptyProgress();
    p = recordResult(l3, p, 'l3-talk', true).progress;
    p = recordResult(l3, p, 'l3-r1', true).progress;
    let o = recordResult(l3, p, 'l3-r2', false);
    expect(o.added).toBeUndefined();
    o = recordResult(l3, o.progress, 'l3-r2', false);
    expect(o.added?.id).toBe('l3-r2s');
    p = o.progress;
    let v = visibleSteps(l3, p);
    expect(v[currentIndex(l3, p)].step.id).toBe('l3-r2s');
    // stall on the smaller step too
    p = recordResult(l3, p, 'l3-r2s', false).progress;
    o = recordResult(l3, p, 'l3-r2s', false);
    expect(o.added?.id).toBe('l3-r2ss');
    p = o.progress;
    v = visibleSteps(l3, p);
    expect(v.map((x) => x.step.id).slice(2, 5)).toEqual(['l3-r2ss', 'l3-r2s', 'l3-r2']);
    // pass upward
    p = recordResult(l3, p, 'l3-r2ss', true).progress;
    expect(v[currentIndex(l3, p)].step.id).toBe('l3-r2s');
    p = recordResult(l3, p, 'l3-r2s', true).progress;
    p = recordResult(l3, p, 'l3-r2', true).progress;
    const done = recordResult(l3, p, 'l3-song', true);
    expect(done.lessonDone).toBe(true);
  });
  it('does not add steps beyond what exists', () => {
    let p = emptyProgress();
    for (let i = 0; i < 10; i++) p = recordResult(l3, p, 'l3-song-s', false).progress;
    expect(p.inserted['l3-song'] ?? 0).toBe(0); // not visible yet, so not grown
  });
});
