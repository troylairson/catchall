/**
 * AudioWorklet that finds strums (sudden volume jumps) with ~1 ms precision,
 * timestamped on the AudioContext clock (the same clock beats are scheduled on).
 *
 * Input 0: band-filtered signal (guitar band, metronome click filtered out)
 * Input 1: raw signal (for the level meter only)
 */
const code = /* js */ `
class OnsetProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.gateDb = -48;
    this.riseDb = 5;
    this.refractory = 0.11;
    this.sub = 64;              // sub-block size in samples
    this.hist = new Float32Array(64).fill(1e-12); // energy history of sub-blocks
    this.hi = 0;
    this.lastOnset = -10;
    this.peakBand = 0;
    this.peakRaw = 0;
    this.lastReport = 0;
    this.port.onmessage = (e) => Object.assign(this, e.data);
  }
  energy(buf, start, n) {
    let s = 0;
    for (let i = start; i < start + n; i++) s += buf[i] * buf[i];
    return s / n;
  }
  process(inputs) {
    const band = inputs[0] && inputs[0][0];
    const raw = inputs[1] && inputs[1][0];
    if (!band) return true;
    const N = band.length;
    const H = this.hist.length;
    for (let s = 0; s < N; s += this.sub) {
      const e = this.energy(band, s, Math.min(this.sub, N - s));
      this.hist[this.hi] = e;
      // fast = mean of the last 3 sub-blocks (~4 ms)
      // ref  = mean of sub-blocks 24..48 ago (~32-64 ms earlier): long enough back that a
      //        strum spread over several strings still shows up as one clear jump
      let fast = 0;
      for (let k = 0; k < 3; k++) fast += this.hist[(this.hi - k + H) % H];
      fast /= 3;
      let ref = 0;
      for (let k = 24; k <= 48; k++) ref += this.hist[(this.hi - k + H) % H];
      ref = ref / 25 + 1e-12;
      this.hi = (this.hi + 1) % H;
      const fastDb = 10 * Math.log10(fast + 1e-12);
      const refDb = 10 * Math.log10(ref);
      const t = currentTime + s / sampleRate;
      if (fastDb > this.gateDb && fastDb - refDb > this.riseDb && t - this.lastOnset > this.refractory) {
        this.lastOnset = t;
        this.port.postMessage({ type: 'onset', time: t, db: fastDb, rise: fastDb - refDb });
      }
      if (fast > this.peakBand) this.peakBand = fast;
    }
    if (raw) {
      for (let i = 0; i < raw.length; i++) {
        const v = raw[i] * raw[i];
        if (v > this.peakRaw) this.peakRaw = v;
      }
    }
    if (currentTime - this.lastReport > 0.04) {
      this.port.postMessage({
        type: 'level',
        time: currentTime,
        bandDb: 10 * Math.log10(this.peakBand + 1e-12),
        rawDb: 10 * Math.log10(this.peakRaw + 1e-12),
      });
      this.peakBand = 0;
      this.peakRaw = 0;
      this.lastReport = currentTime;
    }
    return true;
  }
}
registerProcessor('onset-processor', OnsetProcessor);
`;

let url: string | null = null;
export function onsetWorkletUrl() {
  if (!url) url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
  return url;
}
