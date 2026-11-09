import { engine } from '../audio/engine';
import { bass, click, hat, kick, playStrum, SoundSession } from '../audio/synth';
import { classifyChord, diagnoseChord, heardChord } from '../audio/chroma';
import { BeatMatcher, HitResult, label } from '../feedback/timing';
import { ChordId, CHORDS } from '../music/chords';
import { BEATS_PER_BAR, RhythmCfg } from '../music/songs';
import { settings } from '../state/settings';

export type RunMode = 'watch' | 'tap' | 'play';

export interface ExpectedStrum {
  time: number;
  index: number;
  bar: number;
  beat: number;
  chord: ChordId;
}

export interface Beat {
  time: number;
  bar: number; // -1 = count-in
  beat: number;
}

export interface Popup {
  text: string;
  sub?: string;
  color: string;
  at: number; // context time it appeared
}

const COLORS: Record<string, string> = {
  great: '#1f9d55',
  good: '#6cc28f',
  off: '#c98a00',
  miss: '#9a9087',
  extra: '#d64545',
};

/**
 * One play-through of a rhythm exercise: schedules all sounds up front on the
 * AudioContext clock, then matches strums (or taps) to the expected beats.
 */
export class RhythmRun {
  expected: ExpectedStrum[] = [];
  beats: Beat[] = [];
  t0 = 0;
  end = 0;
  beatDur: number;
  matcher: BeatMatcher;
  popups: Popup[] = [];
  chordOk: (boolean | null)[] = [];
  chordTips: string[] = [];
  finished = false;
  private session: SoundSession;
  private offOnset: (() => void) | null = null;
  /** Bars actually scheduled in this run (watch/tap runs are shorter). */
  bars: number;

  constructor(
    public cfg: RhythmCfg,
    public mode: RunMode,
    private onFinish: (run: RhythmRun) => void,
  ) {
    const ctx = engine.ctx!;
    const s = settings.get();
    this.session = new SoundSession(ctx, engine.out);
    this.beatDur = 60 / cfg.bpm;
    this.bars = mode === 'play' ? cfg.bars : Math.min(cfg.bars, Math.max(2, cfg.chords.length));
    const countIn = BEATS_PER_BAR;
    this.t0 = ctx.currentTime + 0.4 + countIn * this.beatDur;
    const bus = this.session.bus;

    for (let i = -countIn; i < this.bars * BEATS_PER_BAR; i++) {
      const t = this.t0 + i * this.beatDur;
      const bar = i < 0 ? -1 : Math.floor(i / BEATS_PER_BAR);
      const beat = ((i % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
      this.beats.push({ time: t, bar, beat });
      click(ctx, bus, t, s.clickVolume * (cfg.backing && i >= 0 ? 0.6 : 1), beat === 0);
      if (cfg.backing && i >= 0) {
        const bv = s.backingVolume;
        if (beat % 2 === 0) kick(ctx, bus, t, bv * 0.9);
        hat(ctx, bus, t, bv * 0.25);
        hat(ctx, bus, t + this.beatDur / 2, bv * 0.15);
        if (beat === 0 && s.backingBass) {
          const root = CHORDS[this.chordAt(bar)].root;
          bass(ctx, bus, t, 36 + root, this.beatDur * BEATS_PER_BAR * 0.95, bv * 0.5);
        }
      }
    }
    for (let b = 0; b < this.bars; b++) {
      for (const p of cfg.pattern) {
        const t = this.t0 + (b * BEATS_PER_BAR + p) * this.beatDur;
        this.expected.push({ time: t, index: this.expected.length, bar: b, beat: p, chord: this.chordAt(b) });
        if (mode === 'watch') playStrum(ctx, bus, CHORDS[this.chordAt(b)], t, 0.8, Math.min(1.5, this.beatDur * 0.95));
      }
    }
    this.end = this.t0 + this.bars * BEATS_PER_BAR * this.beatDur;
    this.matcher = new BeatMatcher(this.expected, s);
    this.chordOk = this.expected.map(() => null);

    if (mode === 'play') this.offOnset = engine.onOnset((o) => this.strum(o.strumTime, o.time));
    if (import.meta.env?.DEV) (window as any).__run = this;
    engine.log(`${mode} "${cfg.title}" at ${cfg.bpm} bpm, ${this.expected.length} strums`);
  }

  chordAt(bar: number): ChordId {
    return this.cfg.chords[Math.max(0, bar) % this.cfg.chords.length];
  }
  /** Chord checking only matters once a chord needs fingers (the no-finger Em can't be wrong). */
  get usesChordCheck() {
    return this.mode === 'play' && engine.status === 'on' && this.cfg.chords.some((c) => c !== 'emEasy');
  }

  /** Spacebar / click during the tap stage. */
  tap(perfMs: number) {
    if (this.mode !== 'tap' || this.finished) return;
    // perfToCtx maps to the context time that was audible at that moment,
    // which is exactly what a tap is aligned to: no further correction needed
    const t = engine.perfToCtx(perfMs);
    this.strum(t, t);
  }

  private strum(t: number, rawTime: number) {
    if (this.finished || t < this.t0 - this.beatDur) return;
    const r = this.matcher.addStrum(t);
    const now = engine.now();
    if (!r) {
      this.popups.push({ text: 'Extra', color: COLORS.extra, at: now });
      engine.reportTiming(0, 'extra strum');
      return;
    }
    engine.reportTiming(r.offsetMs ?? 0, label(r));
    const popup: Popup = { text: label(r), color: COLORS[r.kind], at: now };
    this.popups.push(popup);
    if (this.usesChordCheck) this.checkChord(r, rawTime, popup);
  }

  private async checkChord(r: HitResult, rawTime: number, popup: Popup) {
    const want = this.expected[r.index].chord;
    const s = settings.get();
    const chroma = await engine.captureChromaAfter(rawTime);
    const g = classifyChord(chroma, ['emEasy', 'cEasy', 'gEasy'], s.chordMatchMin, s.chordMargin);
    const top = g.scores[0];
    engine.reportChord(top ? CHORDS[top.id].name : '?', top?.score ?? 0, `Chord heard: ${g.scores.map((x) => `${CHORDS[x.id].name} ${x.score.toFixed(2)}`).join(', ')} (wanted ${CHORDS[want].name})`);
    const ok = heardChord(g, want, s.chordMatchMin);
    this.chordOk[r.index] = ok;
    if (!ok) {
      popup.sub = g.best ? `sounded like ${CHORDS[g.best].name}` : 'chord unclear';
      if (g.best) this.chordTips.push(`Fix: look at the chord name in the lane and switch to ${CHORDS[want].name} a little earlier.`);
      else this.chordTips.push(...diagnoseChord(chroma, CHORDS[want]));
    }
  }

  /** Call every frame. */
  tick() {
    if (this.finished) return;
    const now = engine.now();
    const strumNow = this.mode === 'tap' ? engine.heardNow() : now - settings.get().latencyMs / 1000;
    if (this.mode !== 'watch') {
      for (const r of this.matcher.expire(strumNow)) {
        this.popups.push({ text: 'Missed', color: COLORS.miss, at: now });
        void r;
      }
    }
    if (now > this.end + settings.get().missWindowMs / 1000 + 0.4) this.finish();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.offOnset?.();
    this.session.stop();
    // give pending chord checks a moment to land
    setTimeout(() => this.onFinish(this), this.usesChordCheck ? 350 : 0);
  }

  cancel() {
    this.finished = true;
    this.offOnset?.();
    this.session.stop();
  }

  results(): HitResult[] {
    return this.matcher.results.map((r, i) => r ?? { index: i, kind: 'miss', offsetMs: null });
  }

  chordAccuracy(): number | null {
    const checked = this.chordOk.filter((x) => x !== null);
    if (!checked.length) return null;
    return checked.filter(Boolean).length / checked.length;
  }

  /** Most common chord problem, if any. */
  topChordTip(): string | null {
    if (!this.chordTips.length) return null;
    const counts = new Map<string, number>();
    this.chordTips.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
}
