import { useRef } from 'react';
import { engine } from '../audio/engine';
import { CHORDS } from '../music/chords';
import { BEATS_PER_BAR, RhythmCfg } from '../music/songs';
import { RhythmRun } from '../features/rhythmRun';
import { useFrame } from './common';

const PX_PER_BEAT = 120;
const HIT_X = 130;

/**
 * The visual rhythm: dots slide right-to-left and you strum when a dot
 * touches the line. Works for a live run, or as a still preview of a pattern.
 */
export function BeatLane({ run, preview, onTap }: { run?: RhythmRun | null; preview?: RhythmCfg; onTap?: (perfMs: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useFrame(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (run) {
      run.tick();
      drawRun(g, w, h, run);
    } else if (preview) drawPreview(g, w, h, preview);
  });

  return (
    <div className="lane-wrap">
      <canvas
        ref={ref}
        className="lane"
        onPointerDown={(e) => onTap?.(e.timeStamp)}
        style={{ cursor: onTap ? 'pointer' : undefined, touchAction: 'manipulation' }}
      />
    </div>
  );
}

function drawDot(g: CanvasRenderingContext2D, x: number, y: number, fill: string, r = 20, arrow = true) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  if (arrow) {
    g.fillStyle = '#fff';
    g.font = `bold ${Math.round(r * 1.1)}px system-ui`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('↓', x, y + 1);
  }
}

function drawRun(g: CanvasRenderingContext2D, w: number, h: number, run: RhythmRun) {
  const now = run.mode === 'play' || run.mode === 'tap' || run.mode === 'watch' ? engine.heardNow() : engine.now();
  const pxPerSec = PX_PER_BEAT / run.beatDur;
  const xOf = (t: number) => HIT_X + (t - now) * pxPerSec;
  const midY = h * 0.48;

  // beat ticks + numbers
  for (const b of run.beats) {
    const x = xOf(b.time);
    if (x < -40 || x > w + 40) continue;
    g.strokeStyle = b.beat === 0 ? '#c9bca8' : '#ece4d6';
    g.lineWidth = b.beat === 0 ? 3 : 1.5;
    g.beginPath();
    g.moveTo(x, midY - 40);
    g.lineTo(x, midY + 40);
    g.stroke();
    g.fillStyle = b.bar < 0 ? '#d9480f' : '#a59a8b';
    g.font = `${b.bar < 0 ? 'bold 20px' : '15px'} system-ui`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillText(b.bar < 0 ? `${b.beat + 1}` : `${b.beat + 1}`, x, midY + 62);
  }

  // chord names at bar starts where the chord changes, and lyrics
  for (let bar = 0; bar < run.bars; bar++) {
    const t = run.t0 + bar * BEATS_PER_BAR * run.beatDur;
    const x = xOf(t);
    if (x < -300 || x > w + 40) continue;
    const ch = run.chordAt(bar);
    const changed = bar === 0 || run.chordAt(bar - 1) !== ch;
    if (changed) {
      g.fillStyle = '#23201c';
      g.font = 'bold 26px system-ui';
      g.textAlign = 'left';
      g.fillText(CHORDS[ch].name, x - 10, midY - 52);
    }
    const lyric = run.cfg.lyrics?.[bar];
    if (lyric) {
      g.fillStyle = '#6f675d';
      g.font = 'italic 17px system-ui';
      g.textAlign = 'left';
      g.fillText(lyric, x - 10, h - 18);
    }
  }

  // hit line
  const sinceBeat = (() => {
    let best = Infinity;
    for (const b of run.beats) if (now >= b.time) best = Math.min(best, now - b.time);
    return best;
  })();
  const pulse = Math.max(0, 1 - sinceBeat / 0.18);
  g.strokeStyle = '#d9480f';
  g.lineWidth = 4 + pulse * 4;
  g.beginPath();
  g.moveTo(HIT_X, midY - 48);
  g.lineTo(HIT_X, midY + 48);
  g.stroke();

  // strum dots
  run.expected.forEach((e, i) => {
    const x = xOf(e.time);
    if (x < -40 || x > w + 40) return;
    const r = run.matcher.results[i];
    const fill = run.mode === 'watch' && e.time < now ? '#e8b49c' : !r ? '#d9480f' : r.kind === 'great' ? '#1f9d55' : r.kind === 'good' ? '#6cc28f' : r.kind === 'off' ? '#c98a00' : '#c4bbb0';
    drawDot(g, x, midY, fill);
  });

  // upcoming change warning
  const nextChange = (() => {
    for (let bar = 1; bar < run.bars; bar++) {
      if (run.chordAt(bar) === run.chordAt(bar - 1)) continue;
      const t = run.t0 + bar * BEATS_PER_BAR * run.beatDur;
      if (t > now) return { t, ch: run.chordAt(bar) };
    }
    return null;
  })();
  if (nextChange && nextChange.t - now < run.beatDur * 1.5 && run.mode !== 'watch') {
    g.fillStyle = '#d9480f';
    g.font = 'bold 18px system-ui';
    g.textAlign = 'left';
    g.fillText(`Get ready: ${CHORDS[nextChange.ch].name}`, 16, 28);
  }

  // the chord you should be holding right now (and the next one)
  if (new Set(run.cfg.chords).size > 1 || now < run.t0) {
    const bar = Math.max(0, Math.min(run.bars - 1, Math.floor((now - run.t0) / (BEATS_PER_BAR * run.beatDur))));
    const cur = run.chordAt(bar);
    g.fillStyle = '#23201c';
    g.font = 'bold 22px system-ui';
    g.textAlign = 'left';
    g.fillText(`Now: ${CHORDS[cur].name}`, 16, h - 48);
    const curW = g.measureText(`Now: ${CHORDS[cur].name}`).width;
    const nx = nextChange ? nextChange.ch : null;
    if (nx) {
      g.fillStyle = '#6f675d';
      g.font = '16px system-ui';
      g.fillText(`next: ${CHORDS[nx].name}`, 16 + curW + 16, h - 48);
    }
  }

  // count-in
  if (now < run.t0) {
    const beatsLeft = Math.ceil((run.t0 - now) / run.beatDur);
    g.fillStyle = 'rgba(217,72,15,0.85)';
    g.font = 'bold 22px system-ui';
    g.textAlign = 'right';
    g.fillText(beatsLeft <= 4 ? `Get ready… ${beatsLeft}` : 'Get ready…', w - 16, 28);
  }

  // feedback popups at the hit line
  const live = run.popups.filter((p) => engine.now() - p.at < 0.9);
  live.slice(-3).forEach((p, k, arr) => {
    const age = engine.now() - p.at;
    g.globalAlpha = Math.max(0, 1 - age / 0.9);
    g.fillStyle = p.color;
    g.font = 'bold 20px system-ui';
    g.textAlign = 'left';
    const y = midY - 90 - age * 30 - (arr.length - 1 - k) * 4;
    g.fillText(p.text, HIT_X + 26, y + 30);
    if (p.sub) {
      g.font = '14px system-ui';
      g.fillText(p.sub, HIT_X + 26, y + 48);
    }
    g.globalAlpha = 1;
  });
}

function drawPreview(g: CanvasRenderingContext2D, w: number, h: number, cfg: RhythmCfg) {
  const midY = h * 0.48;
  const beatW = Math.min(PX_PER_BEAT, (w - 60) / 8);
  const x0 = 40;
  for (let i = 0; i < 8; i++) {
    const x = x0 + i * beatW;
    const beat = i % 4;
    g.strokeStyle = beat === 0 ? '#c9bca8' : '#ece4d6';
    g.lineWidth = beat === 0 ? 3 : 1.5;
    g.beginPath();
    g.moveTo(x, midY - 40);
    g.lineTo(x, midY + 40);
    g.stroke();
    g.fillStyle = '#a59a8b';
    g.font = '15px system-ui';
    g.textAlign = 'center';
    g.fillText(`${beat + 1}`, x, midY + 62);
    if (cfg.pattern.includes(beat)) drawDot(g, x, midY, '#d9480f');
    if (beat === 0) {
      const ch = cfg.chords[Math.floor(i / 4) % cfg.chords.length];
      g.fillStyle = '#23201c';
      g.font = 'bold 24px system-ui';
      g.textAlign = 'left';
      g.fillText(CHORDS[ch].name, x - 10, midY - 52);
    }
  }
  g.fillStyle = '#6f675d';
  g.font = '15px system-ui';
  g.textAlign = 'left';
  g.fillText('Each ↓ dot = one strum. The numbers are the beats you’ll hear as clicks.', 16, h - 16);
}
