// All sounds are synthesized with Web Audio, so there are no audio files.
let ctx = null, master = null, buzzGain = null;
let enabled = true;
const last = {};

export function setSoundEnabled(on) {
  enabled = on;
  if (master) master.gain.setTargetAtTime(on ? 0.7 : 0, ctx.currentTime, 0.02);
}

// Must be called from a user gesture (iOS only allows audio after a tap).
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = enabled ? 0.7 : 0;
      master.connect(ctx.destination);
      // A soft swarm hum whose volume follows the number of bees flying.
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 170;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 11;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 7;
      lfo.connect(lfoGain).connect(osc.frequency);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 520;
      bp.Q.value = 1.3;
      buzzGain = ctx.createGain();
      buzzGain.gain.value = 0;
      osc.connect(bp).connect(buzzGain).connect(master);
      osc.start();
      lfo.start();
    }
    if (ctx.state !== 'running') ctx.resume();
  } catch { /* audio unavailable */ }
}

export function setBuzz(flying) {
  if (!buzzGain) return;
  const v = flying ? Math.min(0.05, 0.012 + flying * 0.0015) : 0;
  buzzGain.gain.setTargetAtTime(v, ctx.currentTime, 0.12);
}

function tone(freq, { type = 'sine', dur = 0.12, vol = 0.2, at = 0, slide = 0 } = {}) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function sfx(name) {
  if (!ctx || !enabled || ctx.state !== 'running') return;
  const now = performance.now();
  // Bees deliver many blocks quickly; keep those ticks from piling up.
  if (name === 'deliver') {
    if (now - (last.deliver || 0) < 70) return;
    last.deliver = now;
    tone(900 + Math.random() * 500, { type: 'triangle', dur: 0.05, vol: 0.05 });
    return;
  }
  switch (name) {
    case 'tap':
      tone(520, { type: 'triangle', dur: 0.1, vol: 0.22, slide: 1.5 });
      tone(260, { type: 'sine', dur: 0.12, vol: 0.12 });
      break;
    case 'done':
      tone(784, { type: 'sine', dur: 0.14, vol: 0.12 });
      tone(1175, { type: 'sine', dur: 0.18, vol: 0.08, at: 0.05 });
      break;
    case 'error':
      tone(160, { type: 'square', dur: 0.12, vol: 0.08, slide: 0.7 });
      break;
    case 'win':
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, { type: 'triangle', dur: 0.25, vol: 0.16, at: i * 0.09 }));
      break;
    case 'lose':
      [392, 330, 262, 196].forEach((f, i) => tone(f, { type: 'triangle', dur: 0.3, vol: 0.14, at: i * 0.13 }));
      break;
    case 'click':
      tone(700, { type: 'sine', dur: 0.05, vol: 0.08 });
      break;
  }
}
