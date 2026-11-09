import { useEffect, useRef } from 'react';
import { engine } from '../audio/engine';
import { NOTE_NAMES, hzToMidi, nearestString, stringName } from '../music/notes';
import { DEFAULT_SETTINGS, SETTING_SPECS, settings } from '../state/settings';
import { describeOffset } from '../feedback/timing';
import { useTicker } from './common';

/**
 * Live view of what the audio detection is doing, plus every threshold as a
 * slider. Toggle with the "Debug" button or the ` key.
 */
export function DebugPanel() {
  const s = settings.use();
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === '`') settings.set({ debugOpen: !settings.get().debugOpen });
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  if (!s.debugOpen)
    return (
      <button className="debug-toggle" onClick={() => settings.set({ debugOpen: true })} title="Show detection details (` key)">
        🛠 Debug
      </button>
    );
  return <Panel />;
}

function Panel() {
  useTicker(60);
  const s = settings.get();
  const p = engine.readPitch();
  const midi = p && p.hz ? hzToMidi(p.hz) : null;
  const ns = p && p.hz ? nearestString(p.hz) : null;
  const onset = engine.lastOnsets[0];
  const sinceOnset = onset ? engine.now() - onset.time : Infinity;
  const ctx = engine.ctx as any;

  const groups = [...new Set(SETTING_SPECS.map((x) => x.group))];

  const copy = () => {
    const data = {
      settings: settings.get(),
      device: engine.deviceLabel,
      sampleRate: ctx?.sampleRate,
      baseLatency: ctx?.baseLatency,
      outputLatency: ctx?.outputLatency,
      levels: engine.levels,
      lastOnsets: engine.lastOnsets.slice(0, 15),
      events: engine.events.slice(0, 15).map((e) => e.text),
      ua: navigator.userAgent,
    };
    navigator.clipboard?.writeText(JSON.stringify(data, null, 2));
    engine.log('Debug info copied to clipboard');
  };

  return (
    <aside className="debug">
      <header>
        <strong>Detection debug</strong>
        <button className="link" onClick={() => settings.set({ debugOpen: false })}>
          close ✕
        </button>
      </header>

      <section>
        <div className="kv">
          <span>Input</span>
          <b>{engine.status === 'on' ? engine.deviceLabel : engine.status}</b>
        </div>
        <div className="kv">
          <span>Sample rate</span>
          <b>{ctx?.sampleRate ?? '—'} Hz</b>
        </div>
        <div className="kv">
          <span>Output latency (browser)</span>
          <b>{ctx ? Math.round(engine.outputLatency() * 1000) : '—'} ms</b>
        </div>
        <div className="kv">
          <span>Calibrated latency</span>
          <b>{s.latencyMs} ms</b>
        </div>
      </section>

      <section>
        <div className="kv">
          <span>Volume (raw)</span>
          <b>{engine.levels.rawDb.toFixed(0)} dB</b>
        </div>
        <DbBar db={engine.levels.rawDb} />
        <div className="kv">
          <span>Volume (guitar band)</span>
          <b>{engine.levels.bandDb.toFixed(0)} dB</b>
        </div>
        <DbBar db={engine.levels.bandDb} gate={s.onsetGateDb} />
      </section>

      <section>
        <div className="kv">
          <span>Pitch</span>
          <b>
            {midi !== null
              ? `${p!.hz.toFixed(1)} Hz · ${NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12]} ${((midi - Math.round(midi)) * 100).toFixed(0)}¢`
              : '—'}
          </b>
        </div>
        <div className="kv">
          <span>Clarity / level</span>
          <b>
            {p ? p.clarity.toFixed(2) : '—'} / {p ? p.db.toFixed(0) : '—'} dB
          </b>
        </div>
        <div className="kv">
          <span>Nearest string</span>
          <b>{ns ? `${stringName(ns.string)} (${ns.cents.toFixed(0)}¢)` : '—'}</b>
        </div>
      </section>

      <section>
        <div className="kv">
          <span>Last strum</span>
          <b className={sinceOnset < 0.15 ? 'flash' : ''}>
            {onset ? `${onset.db.toFixed(0)} dB, jump ${onset.rise.toFixed(1)} dB, ${sinceOnset.toFixed(1)}s ago` : '—'}
          </b>
        </div>
        <div className="kv">
          <span>Strums heard</span>
          <b>{engine.lastOnsets.length >= 30 ? '30+' : engine.lastOnsets.length}</b>
        </div>
        <div className="kv">
          <span>Timing offset</span>
          <b>
            {engine.lastTiming ? `${engine.lastTiming.offsetMs >= 0 ? '+' : ''}${engine.lastTiming.offsetMs.toFixed(0)} ms (${describeOffset(engine.lastTiming.offsetMs)}) – ${engine.lastTiming.label}` : '—'}
          </b>
        </div>
        <div className="kv">
          <span>Strum gaps</span>
          <b className="mono">
            {engine.lastOnsets
              .slice(0, 6)
              .map((o, i, a) => (a[i + 1] ? Math.round((o.time - a[i + 1].time) * 1000) : null))
              .filter((x) => x !== null)
              .join(', ') || '—'}
          </b>
        </div>
        <div className="kv">
          <span>Last chord guess</span>
          <b>{engine.lastChord ? `${engine.lastChord.name} (${engine.lastChord.score.toFixed(2)})` : '—'}</b>
        </div>
        <ChromaBars />
      </section>

      {groups.map((g) => (
        <section key={g}>
          <h4>{g}</h4>
          {SETTING_SPECS.filter((x) => x.group === g).map((spec) => (
            <label key={spec.key} className="slider" title={spec.help}>
              <span>
                {spec.label}
                <em>
                  {String(s[spec.key])}
                  {spec.unit ? ` ${spec.unit}` : ''}
                </em>
              </span>
              <input
                type="range"
                min={spec.min}
                max={spec.max}
                step={spec.step}
                value={s[spec.key] as number}
                onChange={(e) => settings.set({ [spec.key]: Number(e.target.value) } as any)}
              />
              <small>{spec.help}</small>
            </label>
          ))}
          {g === 'Sound' && (
            <label className="check">
              <input type="checkbox" checked={s.backingBass} onChange={(e) => settings.set({ backingBass: e.target.checked })} /> Bass in
              backing (may cause false strums without headphones)
            </label>
          )}
        </section>
      ))}

      <section className="row gap wrap">
        <button
          className="btn small"
          onClick={() => {
            const keep = { deviceId: s.deviceId, channel: s.channel, latencyMs: s.latencyMs, leftHanded: s.leftHanded, debugOpen: true };
            settings.set({ ...DEFAULT_SETTINGS, ...keep });
          }}
        >
          Reset thresholds
        </button>
        <button className="btn small" onClick={copy}>
          Copy debug info
        </button>
      </section>

      <section>
        <h4>Log</h4>
        <ul className="log">
          {engine.events.slice(0, 8).map((e, i) => (
            <li key={i}>{e.text}</li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function DbBar({ db, gate }: { db: number; gate?: number }) {
  const pct = (v: number) => Math.max(0, Math.min(100, ((v + 90) / 90) * 100));
  return (
    <div className="meter thin">
      <div className="meter-fill" style={{ width: `${pct(db)}%` }} />
      {gate !== undefined && <div className="meter-gate" style={{ left: `${pct(gate)}%` }} />}
    </div>
  );
}

function ChromaBars() {
  const ref = useRef<HTMLCanvasElement>(null);
  useTicker(80);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    const v = engine.readChroma();
    const max = Math.max(...v, 1e-9);
    g.clearRect(0, 0, c.width, c.height);
    for (let i = 0; i < 12; i++) {
      const h = Math.sqrt(v[i] / max) * (c.height - 14);
      g.fillStyle = '#2f7de1';
      g.fillRect(i * 20 + 3, c.height - 14 - h, 14, h);
      g.fillStyle = '#888';
      g.font = '9px sans-serif';
      g.fillText(NOTE_NAMES[i], i * 20 + 3, c.height - 2);
    }
  });
  return <canvas ref={ref} width={240} height={60} className="chroma" title="Energy per note name (used for chord checks)" />;
}
