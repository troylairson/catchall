import { Chord, chordNotes } from '../music/chords';
import { midiToHz } from '../music/notes';

/**
 * Sounds the app makes. All are scheduled at exact AudioContext times.
 * The metronome tick is deliberately very high (6-7 kHz) so the strum
 * detector, which only listens to the guitar band, mostly ignores it.
 */

export function click(ctx: BaseAudioContext, dest: AudioNode, t: number, vol: number, accent = false) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = accent ? 7000 : 6000;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol * (accent ? 0.9 : 0.6), t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.04);
}

/** In-band beep used for latency calibration (the detector must hear it). */
export function beep(ctx: BaseAudioContext, dest: AudioNode, t: number, vol = 0.8) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = 880;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.001);
  g.gain.setValueAtTime(vol, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.15);
}

export function kick(ctx: BaseAudioContext, dest: AudioNode, t: number, vol: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(110, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.32);
}

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext) {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** Hi-hat / shaker: noise above 7 kHz, well outside the guitar band. */
export function hat(ctx: BaseAudioContext, dest: AudioNode, t: number, vol: number, len = 0.05) {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  s.connect(f).connect(g).connect(dest);
  s.start(t);
  s.stop(t + len + 0.02);
}

/** Soft sine bass with a slow attack (so it doesn't look like a strum). */
export function bass(ctx: BaseAudioContext, dest: AudioNode, t: number, midi: number, dur: number, vol: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = midiToHz(midi);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.04);
  g.gain.setValueAtTime(vol, t + dur * 0.8);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// ---------- plucked strings (Karplus-Strong), for "hear what it should sound like" ----------

const pluckCache = new Map<string, AudioBuffer>();

function renderPluck(ctx: BaseAudioContext, hz: number, seconds: number): Float32Array {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const out = new Float32Array(n);
  const period = sr / hz;
  const N = Math.floor(period);
  const frac = period - N;
  const buf = new Float32Array(N + 2);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.random() * 2 - 1;
  // soften the pluck a little
  for (let i = 1; i < buf.length; i++) buf[i] = 0.5 * (buf[i] + buf[i - 1]);
  let idx = 0;
  const L = buf.length;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const a = buf[idx];
    const b = buf[(idx + 1) % L];
    const v = a + frac * (b - a);
    out[i] = v;
    const next = 0.996 * 0.5 * (v + prev);
    prev = v;
    buf[idx] = next;
    idx = (idx + 1) % L;
  }
  return out;
}

export function strumBuffer(ctx: BaseAudioContext, chord: Chord): AudioBuffer {
  const key = `${chord.id}@${ctx.sampleRate}`;
  const hit = pluckCache.get(key);
  if (hit) return hit;
  const sr = ctx.sampleRate;
  const len = 1.6;
  const buf = ctx.createBuffer(1, Math.floor(sr * len), sr);
  const d = buf.getChannelData(0);
  const notes = chordNotes(chord);
  let k = 0;
  notes.forEach((m) => {
    if (m === null) return;
    const offset = Math.floor(sr * 0.012 * k++); // strum spread: 12 ms per string
    const p = renderPluck(ctx, midiToHz(m), len);
    for (let i = 0; i + offset < d.length; i++) d[i + offset] += p[i] * 0.3;
  });
  pluckCache.set(key, buf);
  return buf;
}

export function playStrum(ctx: BaseAudioContext, dest: AudioNode, chord: Chord, t: number, vol = 0.8, dur = 1.5) {
  const s = ctx.createBufferSource();
  s.buffer = strumBuffer(ctx, chord);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.setValueAtTime(vol, t + Math.max(0.05, dur - 0.08));
  g.gain.linearRampToValueAtTime(0, t + dur);
  s.connect(g).connect(dest);
  s.start(t);
  s.stop(t + dur + 0.02);
}

export function playNote(ctx: BaseAudioContext, dest: AudioNode, midi: number, t: number, vol = 0.6) {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * 1.5), sr);
  buf.getChannelData(0).set(renderPluck(ctx, midiToHz(midi), 1.5));
  const s = ctx.createBufferSource();
  s.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = vol;
  s.connect(g).connect(dest);
  s.start(t);
}

/** A group of scheduled sounds that can be cancelled together. */
export class SoundSession {
  readonly bus: GainNode;
  constructor(private ctx: AudioContext, dest: AudioNode) {
    this.bus = ctx.createGain();
    this.bus.connect(dest);
  }
  stop() {
    const t = this.ctx.currentTime;
    this.bus.gain.setValueAtTime(this.bus.gain.value, t);
    this.bus.gain.linearRampToValueAtTime(0, t + 0.03);
    setTimeout(() => this.bus.disconnect(), 100);
  }
}
