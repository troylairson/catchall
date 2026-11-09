/**
 * Matching strums to beats, and turning the results into plain-English
 * feedback. Pure functions so they can be unit tested without audio.
 */

export type HitKind = 'great' | 'good' | 'off' | 'miss';

export interface Expected {
  time: number; // context seconds
  index: number;
}

export interface HitResult {
  index: number;
  kind: HitKind;
  offsetMs: number | null; // negative = early
}

export interface Windows {
  greatWindowMs: number;
  okWindowMs: number;
  missWindowMs: number;
}

export function label(r: HitResult): string {
  if (r.kind === 'miss') return 'Missed';
  if (r.kind === 'great') return 'Right on!';
  const early = (r.offsetMs ?? 0) < 0;
  if (r.kind === 'good') return early ? 'A little early' : 'A little late';
  return early ? 'Too early' : 'Too late';
}

export class BeatMatcher {
  results: (HitResult | null)[];
  extras = 0;
  constructor(
    public expected: Expected[],
    private w: Windows,
  ) {
    this.results = expected.map(() => null);
  }

  /** Register a strum. Returns the result it produced, or null for an extra strum. */
  addStrum(t: number): HitResult | null {
    let best = -1;
    let bestD = Infinity;
    this.expected.forEach((e, i) => {
      if (this.results[i]) return;
      const d = Math.abs(t - e.time);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0 || bestD * 1000 > this.w.missWindowMs) {
      this.extras++;
      return null;
    }
    const offsetMs = (t - this.expected[best].time) * 1000;
    const a = Math.abs(offsetMs);
    const kind: HitKind = a <= this.w.greatWindowMs ? 'great' : a <= this.w.okWindowMs ? 'good' : 'off';
    const r = { index: best, kind, offsetMs };
    this.results[best] = r;
    return r;
  }

  /** Mark beats whose catch window has passed as missed. Returns newly missed. */
  expire(now: number): HitResult[] {
    const out: HitResult[] = [];
    this.expected.forEach((e, i) => {
      if (!this.results[i] && now > e.time + this.w.missWindowMs / 1000) {
        const r: HitResult = { index: i, kind: 'miss', offsetMs: null };
        this.results[i] = r;
        out.push(r);
      }
    });
    return out;
  }

  done() {
    return this.results.every((r) => r);
  }
}

export interface Tip {
  problem: string;
  fix: string;
}

export interface Summary {
  score: number; // 0..1
  headline: string;
  tips: Tip[];
  counts: Record<HitKind, number> & { extra: number };
  meanOffsetMs: number | null;
  spreadMs: number | null;
}

export function summarize(results: HitResult[], extras: number, source: 'guitar' | 'tap' = 'guitar'): Summary {
  const counts = { great: 0, good: 0, off: 0, miss: 0, extra: extras };
  results.forEach((r) => counts[r.kind]++);
  const n = results.length || 1;
  const raw = (counts.great + 0.8 * counts.good + 0.3 * counts.off) / n;
  const score = Math.max(0, Math.min(1, raw - (0.5 * extras) / n));

  const offs = results.filter((r) => r.offsetMs !== null).map((r) => r.offsetMs as number);
  const mean = offs.length ? offs.reduce((a, b) => a + b, 0) / offs.length : null;
  const spread =
    offs.length > 2 && mean !== null ? Math.sqrt(offs.reduce((a, b) => a + (b - mean) ** 2, 0) / offs.length) : null;

  const tips: Tip[] = [];
  const heard = n - counts.miss;

  if (heard / n < 0.4) {
    tips.push(
      source === 'tap'
        ? {
            problem: 'Most taps didn’t land near a dot.',
            fix: 'Watch one dot all the way in and tap just as it touches the line. Saying “now” out loud as it lands helps.',
          }
        : {
            problem: "I didn't hear most of your strums.",
            fix: 'Strum a bit harder, or turn the amp up a little. If that does not help, run the Setup check again — the strum gate may be set too high.',
          },
    );
  } else {
    if (mean !== null && mean < -45) {
      tips.push({
        problem: "You're strumming a little before the beat (rushing).",
        fix: 'Wait for the dot to actually touch the line. Try nodding your head with the click and strum on the nod.',
      });
    } else if (mean !== null && mean > 45) {
      tips.push({
        problem: "You're strumming a little after the beat (dragging).",
        fix: 'Start moving your hand down as the dot gets close, so the pick reaches the strings exactly when the dot touches the line.',
      });
    }
    // speeding up or slowing down: compare first half with second half
    if (offs.length >= 6) {
      const h = Math.floor(offs.length / 2);
      const a = avg(offs.slice(0, h));
      const b = avg(offs.slice(h));
      if (b - a < -50)
        tips.push({
          problem: 'You got faster as you went.',
          fix: 'Keep the speed steady by tapping your foot along with the click — let your foot be the boss.',
        });
      else if (b - a > 50)
        tips.push({
          problem: 'You slowed down as you went.',
          fix: 'Keep your strumming arm moving even between strums, like a pendulum, so it never stops and waits.',
        });
    }
    if (spread !== null && spread > 70) {
      tips.push({
        problem: 'Your strums are uneven — some early, some late.',
        fix: 'Keep your arm swinging down and up all the time, like a pendulum. Only touch the strings on the way down when the dot hits.',
      });
    }
    if (counts.miss / n > 0.25) {
      tips.push({
        problem: 'Some beats had no strum.',
        fix: "It's fine to let a shape be messy — keep strumming on time even if your fingers aren't ready. Timing first, tidy fingers later.",
      });
    }
    if (extras / n > 0.25) {
      tips.push({
        problem: 'There were extra strums between the beats.',
        fix: 'Only strum when a dot reaches the line. On the gaps, let your hand swing past without touching the strings.',
      });
    }
  }

  const headline =
    score >= 0.85
      ? 'Excellent — that was right in time!'
      : score >= 0.65
        ? 'Nice! That was in time.'
        : score >= 0.4
          ? "Getting there. Let's tighten it up."
          : "That one was tricky. Let's try again — it gets easier fast.";

  return { score, headline, tips: tips.slice(0, 2), counts, meanOffsetMs: mean, spreadMs: spread };
}

function avg(a: number[]) {
  return a.reduce((x, y) => x + y, 0) / a.length;
}

/** Plain-English summary of a latency/offset number, for the debug panel. */
export function describeOffset(ms: number) {
  if (Math.abs(ms) < 15) return 'on the beat';
  return `${Math.abs(Math.round(ms))} ms ${ms < 0 ? 'early' : 'late'}`;
}
