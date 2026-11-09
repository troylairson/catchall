import { PitchDetector } from 'pitchy';
import { settings, Settings } from '../state/settings';
import { onsetWorkletUrl } from './onsetWorklet';
import { chromaFromSpectrum } from './chroma';

export interface Onset {
  /** Raw detection time on the AudioContext clock (seconds). */
  time: number;
  /** Detection time with latency removed: when the strum really happened. */
  strumTime: number;
  db: number;
  rise: number;
}

export interface PitchReading {
  hz: number;
  clarity: number;
  db: number;
}

export interface DebugEvent {
  at: number;
  text: string;
}

type Status = 'off' | 'starting' | 'on' | 'error';

/**
 * The single audio engine. Owns the AudioContext, the input (laptop mic or
 * USB interface), strum detection, pitch detection and chord "chroma".
 */
class AudioEngine {
  ctx: AudioContext | null = null;
  status: Status = 'off';
  error = '';
  deviceLabel = '';
  /** Everything the app makes noise with goes through here. */
  out!: GainNode;

  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private inputGain!: GainNode;
  private worklet: AudioWorkletNode | null = null;
  private pitchAnalyser!: AnalyserNode;
  private specAnalyser!: AnalyserNode;
  private pitchBuf = new Float32Array(4096);
  private specBuf = new Float32Array(8192 / 2);
  private detector = PitchDetector.forFloat32Array(4096);
  private nodes: AudioNode[] = [];

  private listeners = new Set<() => void>();
  private onsetListeners = new Set<(o: Onset) => void>();

  // live readings for meters/debug
  levels = { rawDb: -120, bandDb: -120 };
  lastOnsets: Onset[] = [];
  lastTiming: { offsetMs: number; label: string; at: number } | null = null;
  lastChord: { name: string; score: number; at: number } | null = null;
  events: DebugEvent[] = [];

  constructor() {
    settings.subscribe(() => this.applySettings(settings.get()));
  }

  // ---------- lifecycle ----------

  async start(): Promise<boolean> {
    if (this.status === 'on' || this.status === 'starting') return this.status === 'on';
    this.setStatus('starting');
    try {
      const s = settings.get();
      if (!this.ctx) {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
        this.out = this.ctx.createGain();
        this.out.connect(this.ctx.destination);
      }
      await this.ctx.resume();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: s.deviceId ? { exact: s.deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 2 },
        },
      });
      const track = this.stream.getAudioTracks()[0];
      this.deviceLabel = track?.label || 'Microphone';
      await this.buildGraph(s);
      this.setStatus('on');
      this.log(`Listening on "${this.deviceLabel}" at ${this.ctx.sampleRate} Hz`);
      return true;
    } catch (e: any) {
      this.error =
        e?.name === 'NotAllowedError'
          ? 'Chrome was not allowed to use the microphone. Click the camera/mic icon in the address bar and choose "Allow".'
          : e?.name === 'OverconstrainedError' || e?.name === 'NotFoundError'
            ? 'That input device was not found. Pick another one on the Setup page.'
            : `Could not start the microphone (${e?.message || e}).`;
      this.setStatus('error');
      return false;
    }
  }

  /** Restart with the current device/channel settings. */
  async restart() {
    this.stopInput();
    this.setStatus('off');
    return this.start();
  }

  private stopInput() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.nodes.forEach((n) => n.disconnect());
    this.nodes = [];
    this.worklet?.port.close();
    this.worklet = null;
    this.stream = null;
    this.source = null;
  }

  private async buildGraph(s: Settings) {
    const ctx = this.ctx!;
    await ctx.audioWorklet.addModule(onsetWorkletUrl());
    this.source = ctx.createMediaStreamSource(this.stream!);
    this.inputGain = ctx.createGain();
    this.inputGain.gain.value = dbToGain(s.inputGainDb);

    // choose input channel (USB interfaces often put the guitar on input 1 only)
    if (s.channel === 'mix') {
      this.source.connect(this.inputGain);
    } else {
      const split = ctx.createChannelSplitter(2);
      this.source.connect(split);
      split.connect(this.inputGain, s.channel === 'left' ? 0 : 1);
      this.nodes.push(split);
    }

    // band for strum detection: 400 Hz - 3 kHz. The pick attack and fresh upper
    // overtones live here, while old ringing strings fade from it quickly. It also
    // cuts the backing kick/bass (low) and the metronome tick (6-7 kHz).
    const hp1 = biquad(ctx, 'highpass', 400);
    const hp2 = biquad(ctx, 'highpass', 400);
    const lp1 = biquad(ctx, 'lowpass', 3000);
    const lp2 = biquad(ctx, 'lowpass', 3000);
    this.inputGain.connect(hp1).connect(hp2).connect(lp1).connect(lp2);

    this.worklet = new AudioWorkletNode(ctx, 'onset-processor', { numberOfInputs: 2, numberOfOutputs: 1 });
    lp2.connect(this.worklet, 0, 0);
    this.inputGain.connect(this.worklet, 0, 1);
    this.worklet.port.onmessage = (e) => this.onWorkletMessage(e.data);

    this.pitchAnalyser = ctx.createAnalyser();
    this.pitchAnalyser.fftSize = 4096;
    this.inputGain.connect(this.pitchAnalyser);

    this.specAnalyser = ctx.createAnalyser();
    this.specAnalyser.fftSize = 8192;
    this.specAnalyser.smoothingTimeConstant = 0;
    this.inputGain.connect(this.specAnalyser);

    // keep the graph pulled without making any sound
    const sink = ctx.createGain();
    sink.gain.value = 0;
    this.worklet.connect(sink);
    this.pitchAnalyser.connect(sink);
    this.specAnalyser.connect(sink);
    sink.connect(ctx.destination);

    this.nodes.push(this.source, this.inputGain, hp1, hp2, lp1, lp2, this.worklet, this.pitchAnalyser, this.specAnalyser, sink);
    this.applySettings(s);
  }

  private applySettings(s: Settings) {
    if (!this.ctx) return;
    if (this.inputGain) this.inputGain.gain.setTargetAtTime(dbToGain(s.inputGainDb), this.ctx.currentTime, 0.02);
    this.worklet?.port.postMessage({
      gateDb: s.onsetGateDb,
      riseDb: s.onsetRiseDb,
      refractory: s.onsetRefractoryMs / 1000,
    });
  }

  private onWorkletMessage(d: any) {
    if (d.type === 'level') {
      this.levels = { rawDb: d.rawDb, bandDb: d.bandDb };
    } else if (d.type === 'onset') {
      const o: Onset = { time: d.time, strumTime: d.time - settings.get().latencyMs / 1000, db: d.db, rise: d.rise };
      this.lastOnsets = [o, ...this.lastOnsets].slice(0, 30);
      this.onsetListeners.forEach((l) => l(o));
    }
  }

  // ---------- subscriptions ----------

  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  onOnset(l: (o: Onset) => void) {
    this.onsetListeners.add(l);
    return () => void this.onsetListeners.delete(l);
  }
  private setStatus(s: Status) {
    this.status = s;
    this.listeners.forEach((l) => l());
  }

  // ---------- readings ----------

  readPitch(): PitchReading | null {
    if (!this.ctx || this.status !== 'on') return null;
    this.pitchAnalyser.getFloatTimeDomainData(this.pitchBuf);
    let sum = 0;
    for (let i = 0; i < this.pitchBuf.length; i++) sum += this.pitchBuf[i] * this.pitchBuf[i];
    const db = 10 * Math.log10(sum / this.pitchBuf.length + 1e-12);
    const s = settings.get();
    if (db < s.pitchMinDb) return { hz: 0, clarity: 0, db };
    const [hz, clarity] = this.detector.findPitch(this.pitchBuf, this.ctx.sampleRate);
    if (clarity < s.pitchClarity || hz < 60 || hz > 1400) return { hz: 0, clarity, db };
    return { hz, clarity, db };
  }

  readChroma(): Float32Array {
    if (!this.ctx || this.status !== 'on') return new Float32Array(12);
    this.specAnalyser.getFloatFrequencyData(this.specBuf);
    return chromaFromSpectrum(this.specBuf, this.ctx.sampleRate, this.specAnalyser.fftSize);
  }

  /** Average chroma over a short window after a strum (skips the scratchy pick attack). */
  captureChromaAfter(onsetTime: number, fromMs = 90, toMs = 320): Promise<Float32Array> {
    return new Promise((resolve) => {
      const acc = new Float32Array(12);
      let frames = 0;
      const tick = () => {
        const now = this.now();
        const since = (now - onsetTime) * 1000;
        if (since >= fromMs) {
          const c = this.readChroma();
          for (let i = 0; i < 12; i++) acc[i] += c[i];
          frames++;
        }
        if (since >= toMs || this.status !== 'on') {
          if (frames === 0) acc.set(this.readChroma());
          resolve(acc);
        } else setTimeout(tick, 20);
      };
      tick();
    });
  }

  // ---------- clock helpers ----------

  now() {
    return this.ctx?.currentTime ?? 0;
  }
  /** Seconds between scheduling a sound and it coming out of the speakers. */
  outputLatency() {
    const c = this.ctx as any;
    if (!c) return 0;
    return (c.outputLatency || 0) + (c.baseLatency || 0);
  }
  /** The context time of the sound that is reaching your ears right now. */
  heardNow() {
    return this.now() - this.outputLatency();
  }
  /**
   * Convert a performance.now()/event.timeStamp (ms) to the context time that
   * was coming out of the speakers at that moment.
   */
  perfToCtx(perfMs: number) {
    const c = this.ctx;
    if (!c) return 0;
    const ts = c.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime) {
      return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    }
    return c.currentTime - this.outputLatency() - (performance.now() - perfMs) / 1000;
  }

  /** Make sure there is an AudioContext for playback even before the mic is on. */
  async ensureContext() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
    }
    await this.ctx.resume();
    return this.ctx;
  }

  // ---------- debug helpers ----------

  reportTiming(offsetMs: number, label: string) {
    this.lastTiming = { offsetMs, label, at: performance.now() };
  }
  reportChord(name: string, score: number, detail?: string) {
    this.lastChord = { name, score, at: performance.now() };
    if (detail) this.log(detail);
  }
  log(text: string) {
    this.events = [{ at: performance.now(), text }, ...this.events].slice(0, 40);
  }
}

function dbToGain(db: number) {
  return Math.pow(10, db / 20);
}
function biquad(ctx: AudioContext, type: BiquadFilterType, f: number) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = 0.707;
  return b;
}

export const engine = new AudioEngine();

export async function listInputs(): Promise<MediaDeviceInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'audioinput');
}

// Handy for poking at detection from the browser console during development.
if (import.meta.env?.DEV) (window as any).__engine = engine;
